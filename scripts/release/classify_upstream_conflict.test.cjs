const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyUpstreamConflict } = require('./classify_upstream_conflict.cjs');

test('keeps repository-owned workflow files', () => {
  assert.equal(classifyUpstreamConflict('.github/workflows/release.yml'), 'repository');
});

test('uses official frontend, Go, and Rust tests', () => {
  assert.equal(classifyUpstreamConflict('src/utils/model.test.ts'), 'upstream');
  assert.equal(classifyUpstreamConflict('src/components/widget.spec.tsx'), 'upstream');
  assert.equal(classifyUpstreamConflict('sidecars/gateway/provider_test.go'), 'upstream');
  assert.equal(classifyUpstreamConflict('src-tauri/src/modules/account_tests.rs'), 'upstream');
  assert.equal(classifyUpstreamConflict('crates/core/tests/routing.rs'), 'upstream');
});

test('blocks runtime and repository release-script conflicts', () => {
  assert.equal(classifyUpstreamConflict('src/App.tsx'), 'block');
  assert.equal(classifyUpstreamConflict('src-tauri/tauri.conf.json'), 'block');
  assert.equal(classifyUpstreamConflict('src/stores/useTopRightAdStore.ts'), 'block');
  assert.equal(classifyUpstreamConflict('scripts/release/release_state.test.cjs'), 'block');
});

test('rejects paths that are not safe repository-relative paths', () => {
  assert.throws(() => classifyUpstreamConflict('../outside.test.ts'));
  assert.throws(() => classifyUpstreamConflict('/tmp/file.test.ts'));
  assert.throws(() => classifyUpstreamConflict(''));
});
