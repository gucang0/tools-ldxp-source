const { execFileSync, spawnSync } = require('node:child_process');

function compareVersions(left, right) {
  const parts = [left, right].map((value) => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Invalid stable version: ${value}`);
    return value.split('.').map(Number);
  });
  for (let index = 0; index < 3; index += 1) {
    if (parts[0][index] !== parts[1][index]) return Math.sign(parts[0][index] - parts[1][index]);
  }
  return 0;
}

function needsSync(upstream, source, published) {
  if (compareVersions(published, source) > 0) {
    throw new Error('Published release is ahead of source main; reconcile source before another publication');
  }
  if (compareVersions(upstream, source) < 0) {
    if (compareVersions(source, published) !== 0) throw new Error('Source/release mismatch while upstream is older');
    return false;
  }
  return compareVersions(upstream, source) > 0 || compareVersions(source, published) > 0;
}

async function recoverRelease(state, api) {
  const { version, releaseId, sourcePromoted, previousTag } = state;
  const release = await api.getRelease(releaseId);
  if (!release) return 'already-absent';
  if (String(release.id) !== String(releaseId) || release.tag_name !== `v${version}`) {
    throw new Error('Recovery release identity mismatch; refusing to change any release');
  }
  // A committed source promotion is the transaction boundary. Never undo its release.
  if (sourcePromoted) return 'preserved-promoted-release';
  if (!release.draft) {
    if (!/^v\d+\.\d+\.\d+$/.test(previousTag) || compareVersions(previousTag.slice(1), version) >= 0) {
      throw new Error('Invalid rollback destination; refusing to change Latest');
    }
    const latest = await api.getLatest();
    if (latest.tag_name === release.tag_name) {
      await api.restoreLatest(previousTag);
      if ((await api.getLatest()).tag_name !== previousTag) throw new Error('Previous Latest was not restored');
    } else if (latest.tag_name !== previousTag && compareVersions(latest.tag_name.slice(1), version) <= 0) {
      throw new Error('Unexpected Latest release during recovery');
    }
  }
  await api.deleteRelease(releaseId);
  return 'removed-failed-owned-release';
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'detect') {
    process.stdout.write(String(needsSync(...args)));
    return;
  }
  if (command !== 'recover') throw new Error(`Unknown command: ${command}`);
  const [repo, version, releaseId, previousTag, sourceCommit] = args;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(releaseId) || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error('Invalid recovery identity');
  }
  compareVersions(version, version);
  execFileSync('git', ['fetch', 'origin', 'main', '--quiet'], { stdio: 'pipe' });
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', sourceCommit, 'origin/main']);
  if (ancestry.error || ![0, 1].includes(ancestry.status)) throw new Error('Unable to verify source promotion');
  const api = {
    getRelease: (id) => JSON.parse(gh(['api', `repos/${repo}/releases/${id}`])),
    getLatest: () => JSON.parse(gh(['api', `repos/${repo}/releases/latest`])),
    restoreLatest: (tag) => gh(['release', 'edit', tag, '--repo', repo, '--latest']),
    deleteRelease: (id) => gh(['api', '--method', 'DELETE', `repos/${repo}/releases/${id}`]),
  };
  console.log(await recoverRelease({ version, releaseId, previousTag, sourcePromoted: ancestry.status === 0 }, api));
}

if (require.main === module) main().catch((error) => {
  console.error(`[release_state] ${error.message}`);
  process.exitCode = 1;
});

module.exports = { compareVersions, needsSync, recoverRelease };
