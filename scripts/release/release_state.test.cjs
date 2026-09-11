const assert = require('node:assert/strict');
const test = require('node:test');
const { compareVersions, needsSync, recoverRelease } = require('./release_state.cjs');

test('version comparison is numeric and rejects invalid versions', () => {
  assert.equal(compareVersions('1.3.100', '1.3.99'), 1);
  assert.equal(compareVersions('1.3.9', '1.4.0'), -1);
  assert.throws(() => compareVersions('1.2', '1.2.3'));
});
test('detects new upstream and a missing publication even when source is current', () => {
  assert.equal(needsSync('1.3.48', '1.3.47', '1.3.47'), true);
  assert.equal(needsSync('1.3.48', '1.3.48', '1.3.47'), true);
  assert.equal(needsSync('1.3.48', '1.3.48', '1.3.48'), false);
  assert.equal(needsSync('1.3.47', '1.3.48', '1.3.48'), false);
  assert.throws(() => needsSync('1.3.48', '1.3.47', '1.3.48'), /reconcile/);
});

function fixture(overrides = {}) {
  const calls = [];
  let latest = overrides.latest || 'v1.3.48';
  return { calls, state: { version: '1.3.48', releaseId: '123', previousTag: 'v1.3.47', sourcePromoted: false, ...overrides.state }, api: {
    getRelease: async () => ({ id: 123, tag_name: 'v1.3.48', draft: false, ...overrides.release }),
    getLatest: async () => ({ tag_name: latest }),
    restoreLatest: async (tag) => { calls.push(['restore', tag]); if (!overrides.restoreFails) latest = tag; },
    deleteRelease: async (id) => { calls.push(['delete', id]); },
  } };
}
test('cancellation after source promotion never deletes or demotes the release', async () => {
  const f = fixture({ state: { sourcePromoted: true } });
  assert.equal(await recoverRelease(f.state, f.api), 'preserved-promoted-release');
  assert.deepEqual(f.calls, []);
});
test('rollback verifies previous Latest before deleting only the owned release ID', async () => {
  const f = fixture();
  await recoverRelease(f.state, f.api);
  assert.deepEqual(f.calls, [['restore', 'v1.3.47'], ['delete', '123']]);
});
test('rollback does not erase a release when restoration fails', async () => {
  const f = fixture({ restoreFails: true });
  await assert.rejects(recoverRelease(f.state, f.api), /not restored/);
  assert.deepEqual(f.calls, [['restore', 'v1.3.47']]);
});
test('rollback does not replace a newer Latest release', async () => {
  const f = fixture({ latest: 'v1.3.49' });
  await recoverRelease(f.state, f.api);
  assert.deepEqual(f.calls, [['delete', '123']]);
});
test('draft cleanup does not change Latest, and refuses another release identity', async () => {
  const f = fixture({ release: { draft: true } });
  await recoverRelease(f.state, f.api);
  assert.deepEqual(f.calls, [['delete', '123']]);
  const other = fixture({ release: { id: 999 } });
  await assert.rejects(recoverRelease(other.state, other.api), /identity mismatch/);
  assert.deepEqual(other.calls, []);
});
