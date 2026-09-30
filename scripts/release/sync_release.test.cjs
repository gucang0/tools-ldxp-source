const test = require('node:test');
const assert = require('node:assert/strict');
const { stableRelease, decision, retryDecision, retryRead } = require('./sync_release.cjs');
test('stable versions only, numeric comparison, no duplicate build', () => {
  for (const release of [{tag_name:'v1.2.3',draft:true}, {tag_name:'v1.2.3',prerelease:true}, {tag_name:'v1.2.3-beta'}]) assert.throws(() => stableRelease(release));
  assert.equal(stableRelease({tag_name:'v1.2.3',draft:false,prerelease:false}), '1.2.3');
  assert.equal(decision('1.3.9','1.3.10',false), 'no-update');
  assert.equal(decision('1.3.10','1.3.10',false), 'no-update');
  assert.equal(decision('1.3.11','1.3.10',true), 'busy');
  assert.equal(decision('1.3.11','1.3.10',false), 'prepare');
  assert.equal(decision('1.3.10','1.3.10',false,true), 'prepare');
});
test('only transient failures retry and changed main clears deterministic blockers', () => {
  const run = {display_title:'candidate',head_sha:'main1',conclusion:'failure',run_attempt:1};
  assert.equal(retryDecision([run], 'candidate','main1','HTTP status: 503'), 'dispatch');
  assert.equal(retryDecision([run], 'candidate','main1','could not compile'), 'blocked');
  assert.equal(retryDecision([run], 'candidate','main2','could not compile'), 'dispatch');
  assert.equal(retryDecision([{...run,run_attempt:3}], 'candidate','main1','HTTP status: 503'), 'blocked');
  assert.equal(retryDecision([run,run,run], 'candidate','main1','HTTP status: 503'), 'blocked');
});
test('read retries are bounded and do not retry authorization errors', async () => {
  let attempts=0;
  await assert.rejects(retryRead(() => {attempts++; throw Error('HTTP 503');}, async()=>{}));
  assert.equal(attempts,3);
  attempts=0;
  await assert.rejects(retryRead(() => {attempts++; throw Error('HTTP 403');}, async()=>{}));
  assert.equal(attempts,1);
});
