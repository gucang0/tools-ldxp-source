const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function sanitize(value, fallback = 'unknown') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeOneLine(value, fallback = 'unknown') {
  return sanitize(value, fallback)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\b(token|password|secret|private[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

function buildIssueTitle({ phase, version, sourceCommit }) {
  return `[automation] upstream maintenance: v${safeOneLine(version)} (${safeOneLine(phase)} ${safeOneLine(sourceCommit, 'no-source').slice(0, 12)})`;
}

function buildIssueBody({ phase, version, sourceCommit, runUrl, error, failedJobs, repository, officialRepository }) {
  const jobs = safeOneLine(failedJobs, 'not provided');
  const message = safeOneLine(error, 'The workflow stopped without an error message.');
  return [
    '# Automated upstream maintenance required',
    '',
    `- Repository: ${repository}`,
    `- Official repository: ${officialRepository}`,
    `- Phase: ${safeOneLine(phase)}`,
    `- Official version: v${safeOneLine(version)}`,
    `- Source commit: \`${safeOneLine(sourceCommit)}\``,
    `- Workflow run: ${safeOneLine(runUrl)}`,
    `- Failed jobs: ${jobs}`,
    '',
    '## Reason',
    '',
    '```text',
    message,
    '```',
    '',
    'The release workflow stopped fail-closed. Review the upstream shape, update the scoped customization policy or adapter, add a regression test, and rerun the dry-run before publishing.',
    '',
    'Do not bypass source, signature, manifest, architecture, or updater checks to force a release.',
  ].join('\n');
}

function runGh(args, options = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  }).trim();
}

function issueAlreadyOpen({ repository, title }, run = runGh) {
  const result = run([
    'issue', 'list', '--repo', repository, '--state', 'open', '--limit', '20',
    '--search', `in:title ${title}`,
    '--json', 'title',
  ]);
  if (!result) return false;
  const issues = JSON.parse(result);
  return issues.some(issue => issue.title === title);
}

function reportMaintenanceIssue(options, run = runGh) {
  const repository = sanitize(options.repository || process.env.GITHUB_REPOSITORY);
  const officialRepository = sanitize(options.officialRepository || 'jlcodes99/cockpit-tools');
  const title = buildIssueTitle(options);
  const body = buildIssueBody({ ...options, repository, officialRepository });
  if (options.dryRun || process.env.MAINTENANCE_ISSUES === 'false') return { created: false, reason: 'disabled' };
  if (!repository || repository === 'unknown') return { created: false, reason: 'missing-repository' };
  const exists = issueAlreadyOpen({ repository, title }, run);
  if (exists) return { created: false, reason: 'already-open', title };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-maintenance-'));
  const bodyPath = path.join(dir, 'body.md');
  try {
    fs.writeFileSync(bodyPath, body, 'utf8');
    const url = run(['issue', 'create', '--repo', repository, '--title', title, '--body-file', bodyPath]);
    return { created: true, title, url };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = reportMaintenanceIssue({
      phase: args.phase,
      version: args.version,
      sourceCommit: args['source-commit'],
      runUrl: args['run-url'] || process.env.GITHUB_SERVER_URL && `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      error: args.error || process.env.MAINTENANCE_ERROR,
      failedJobs: args['failed-jobs'] || process.env.FAILED_JOBS,
      repository: args.repository || process.env.GITHUB_REPOSITORY,
      officialRepository: args['official-repository'] || process.env.UPSTREAM_REPOSITORY,
      dryRun: args['dry-run'] === 'true',
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    // Reporting must never mask the original workflow failure.
    console.error(`[maintenance-report] ${error.message}`);
    process.exitCode = 0;
  }
}

module.exports = { buildIssueTitle, buildIssueBody, issueAlreadyOpen, reportMaintenanceIssue, sanitize };
