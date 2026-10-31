const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIssueTitle, buildIssueBody, reportMaintenanceIssue } = require('./report_maintenance_issue.cjs');

test('maintenance issue identity is stable and safely deduplicated', () => {
  const title = buildIssueTitle({ phase: 'candidate-prepare', version: '1.3.81', sourceCommit: 'abcdef1234567890' });
  assert.equal(title, '[automation] upstream maintenance: v1.3.81 (candidate-prepare abcdef123456)');
  assert.equal(buildIssueTitle({ phase: 'candidate-prepare', version: '1.3.81', sourceCommit: 'abcdef1234567890' }), title);
  assert.doesNotMatch(title, /[\r\n]/);
});

test('issue body contains the repair contract without secrets or raw logs', () => {
  const body = buildIssueBody({
    phase: 'release', version: '1.3.81', sourceCommit: 'a'.repeat(40),
    runUrl: 'https://github.com/example/repo/actions/runs/42',
    error: 'patch failed\nTOKEN=should-not-be-a-log', failedJobs: 'build-windows=failure',
    repository: 'gucang0/tools-ldxp-source', officialRepository: 'jlcodes99/cockpit-tools',
  });
  assert.match(body, /fail-closed/);
  assert.match(body, /Do not bypass/);
  assert.doesNotMatch(body, /TOKEN=should-not-be-a-log/);
  assert.match(body, /patch failed TOKEN=\[REDACTED\]/);
});

test('report creates once and then reuses an open issue', () => {
  const calls = [];
  const run = args => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    return 'https://github.com/example/repo/issues/7';
  };
  const options = { phase: 'candidate-prepare', version: '1.3.81', sourceCommit: 'a'.repeat(40), error: 'needs maintenance', repository: 'example/repo' };
  assert.deepEqual(reportMaintenanceIssue(options, run), { created: true, title: '[automation] upstream maintenance: v1.3.81 (candidate-prepare aaaaaaaaaaaa)', url: 'https://github.com/example/repo/issues/7' });
  assert.equal(calls.filter(args => args[1] === 'create').length, 1);
  const existing = reportMaintenanceIssue(options, args => {
    if (args[1] === 'list') return JSON.stringify([{ title: options && '[automation] upstream maintenance: v1.3.81 (candidate-prepare aaaaaaaaaaaa)' }]);
    throw Error('must not create');
  });
  assert.equal(existing.reason, 'already-open');
});

test('dry-run reporting is side-effect free', () => {
  let called = false;
  const result = reportMaintenanceIssue({ phase: 'test', version: '1.0.0', sourceCommit: 'a', error: 'x', repository: 'example/repo', dryRun: true }, () => { called = true; });
  assert.deepEqual(result, { created: false, reason: 'disabled' });
  assert.equal(called, false);
});
