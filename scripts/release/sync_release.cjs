const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { git, officialVersion, prepareCandidate } = require('./prepare_candidate.cjs');
const { compareVersions } = require('./release_state.cjs');
const { isTransientFailure } = require('./bundle_with_retry.cjs');

function stableRelease(release) {
  if (!release || release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw Error('Expected a stable official release');
  return release.tag_name.slice(1);
}
function decision(upstream, published, active, validateCurrent = false) {
  if (compareVersions(upstream, published) <= 0 && !validateCurrent) return 'no-update';
  if (active) return 'busy';
  return 'prepare';
}
function retryDecision(runs, title, main, logs) {
  const failed = runs.filter(r => r.display_title === title && r.head_sha === main && ['failure', 'cancelled', 'timed_out'].includes(r.conclusion));
  if (!failed.length) return 'dispatch';
  if (failed.reduce((n, r) => n + (r.run_attempt || 1), 0) >= 3) return 'blocked';
  if (/error\[E\d+\]|could not compile|test failed|version mismatch|signature.*(invalid|mismatch)/i.test(logs)) return 'blocked';
  return isTransientFailure(logs) || /HTTP (408|429|5\d\d)/i.test(logs) ? 'dispatch' : 'blocked';
}
async function retryRead(fn, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { return fn(); } catch (error) {
      const message = `${error.message}\n${error.stderr || ''}`;
      if (attempt >= 2 || !/HTTP (408|429|5\d\d)|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timeout|timed out|connection reset|TLS handshake|Could not resolve/i.test(message)) throw error;
      await sleep(2000 * (attempt + 1));
    }
  }
}
async function main() {
  const root = path.resolve(__dirname, '../..');
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo !== 'gucang0/tools-ldxp-source' || process.env.GITHUB_REF !== 'refs/heads/main') throw Error('Sync must run from the source repository main workflow');
  const dryRun = process.env.DRY_RUN === 'true';
  const validateCurrent = process.env.VALIDATE_CURRENT === 'true';
  if (validateCurrent && !dryRun) throw Error('Current-version validation must be a dry run');
  const gh = args => execFileSync('gh', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const api = async endpoint => JSON.parse(await retryRead(() => gh(['api', endpoint])));
  const summary = text => {
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  };
  const upstreamRelease = await api('repos/jlcodes99/cockpit-tools/releases/latest');
  const version = stableRelease(upstreamRelease);
  const published = stableRelease(await api('repos/gucang0/tools/releases/latest'));
  const { workflow_runs: runs } = await api(`repos/${repo}/actions/workflows/ldxp-release.yml/runs?event=workflow_dispatch&per_page=100`);
  const next = decision(version, published, runs.some(r => r.status !== 'completed'), validateCurrent);
  summary(`Official: v${version}; published: v${published}; decision: ${next}`);
  if (next !== 'prepare') return;
  if (!upstreamRelease.assets.some(a => a.name === `Cockpit.Tools_${version}_x64-setup.exe`)) throw Error('Official Windows installer is not ready');
  if (git(root, ['status', '--porcelain'])) throw Error('Refusing to prepare from a dirty checkout');
  await retryRead(() => git(root, ['fetch', 'origin', 'main']));
  const mainCommit = git(root, ['rev-parse', 'origin/main']);
  if (mainCommit !== process.env.GITHUB_SHA) throw Error('Main changed after dispatch; wait for the next check');
  await retryRead(() => git(root, ['fetch', 'https://github.com/jlcodes99/cockpit-tools.git', `refs/tags/v${version}`]));
  const upstream = git(root, ['rev-parse', 'FETCH_HEAD^{commit}']);
  officialVersion(root, upstream, version);
  const branch = `automation/candidate-v${version}`;
  const remote = await retryRead(() => git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]));
  let previous;
  if (remote) {
    await retryRead(() => git(root, ['fetch', 'origin', `refs/heads/${branch}`]));
    previous = git(root, ['rev-parse', 'FETCH_HEAD']);
  }
  git(root, ['config', 'user.name', 'github-actions[bot]']);
  git(root, ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  const source = prepareCandidate(root, upstream, mainCommit, version, previous);
  const title = `Cockpit Tools v${version} | ${dryRun ? 'dry-run' : 'publish'} | ${source}`;
  const failed = runs.find(r => r.display_title === title && r.head_sha === mainCommit && ['failure', 'cancelled', 'timed_out'].includes(r.conclusion));
  const logs = failed ? await retryRead(() => gh(['run', 'view', String(failed.id), '--repo', repo, '--log-failed'])) : '';
  if (retryDecision(runs, title, mainCommit, logs) === 'blocked') {
    throw Error(`Candidate v${version} needs maintenance; refusing repeated builds. Failed run: ${failed?.html_url}. A repaired main commit is re-evaluated automatically.`);
  }
  // A normal push must fast-forward an existing candidate; never force-push it.
  git(root, ['push', 'origin', `${source}:refs/heads/${branch}`]);
  // Recheck before dispatch; the scheduled/manual detector is serialized as well.
  const active = await api(`repos/${repo}/actions/workflows/ldxp-release.yml/runs?event=workflow_dispatch&per_page=100`);
  if (active.workflow_runs.some(r => r.status !== 'completed')) { summary('A release is active; candidate preserved for the next check.'); return; }
  if (!dryRun && compareVersions(version, stableRelease(await api('repos/gucang0/tools/releases/latest'))) <= 0) { summary('Version already published; no dispatch.'); return; }
  gh(['workflow', 'run', 'ldxp-release.yml', '--repo', repo, '--ref', 'main',
    '-f', `version=${version}`, '-f', `upstream_commit=${upstream}`, '-f', `source_commit=${source}`,
    '-f', `candidate_branch=${branch}`, '-f', `publish=${!dryRun}`]);
  summary(`Dispatched ${title}; upstream ${upstream}.`);
}
if (require.main === module) main().catch(error => {
  const message = `BLOCKED: ${error.message}`;
  console.error(message);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${message}\n`);
  process.exitCode = 1;
});
module.exports = { stableRelease, decision, retryDecision, retryRead };
