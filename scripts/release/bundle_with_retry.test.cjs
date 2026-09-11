const assert = require('node:assert/strict');
const test = require('node:test');
const { bundleWithRetry } = require('./bundle_with_retry.cjs');
test('retries HTTP 500 downloads without invoking the application build', async () => {
  let calls = 0;
  const delays = [];
  await bundleWithRetry(() => ++calls < 3 ? { status: 1, stderr: 'failed to bundle project `http status: 500`' } : { status: 0 }, {
    sleep: async (ms) => delays.push(ms), log: () => {},
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5000, 10000]);
});
test('does not retry deterministic failures and bounds transient retries', async () => {
  for (const [message, expected] of [['invalid config', 1], ['http status: 503', 3]]) {
    let calls = 0;
    await assert.rejects(bundleWithRetry(() => { calls++; return { status: 1, stderr: message }; }, {
      sleep: async () => {}, log: () => {},
    }), /bundling failed/);
    assert.equal(calls, expected);
  }
});
