const test = require('node:test');
const assert = require('node:assert/strict');
const { stableRelease, decision, retryDecision, retryRead, isMaintenanceFailure } = require('./sync_release.cjs');
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
  const run = {id:1,display_title:'candidate',head_sha:'main1',conclusion:'failure',run_attempt:1};
  assert.equal(retryDecision([run], 'candidate','main1',{1:'HTTP status: 503'}), 'dispatch');
  assert.equal(retryDecision([run], 'candidate','main1',{1:'could not compile'}), 'blocked');
  assert.equal(retryDecision([run], 'candidate','main1',{}), 'blocked');
  assert.equal(retryDecision([run], 'candidate','main2',{1:'could not compile'}), 'dispatch');
  assert.equal(retryDecision([{...run,run_attempt:3}], 'candidate','main1',{1:'HTTP status: 503'}), 'blocked');
  assert.equal(retryDecision([run,run,run], 'candidate','main1',{1:'HTTP status: 503'}), 'blocked');
});
test('cancelled or timed out runs retry within budget without masking failures', () => {
  const cancelled = {id:2,display_title:'candidate',head_sha:'main1',conclusion:'cancelled',run_attempt:1};
  const timedOut = {...cancelled,id:3,conclusion:'timed_out'};
  const failed = {...cancelled,id:4,conclusion:'failure'};
  assert.equal(retryDecision([cancelled], 'candidate','main1'), 'dispatch');
  assert.equal(retryDecision([timedOut], 'candidate','main1'), 'dispatch');
  assert.equal(retryDecision([{...cancelled,run_attempt:3}], 'candidate','main1'), 'blocked');
  assert.equal(retryDecision([cancelled,failed], 'candidate','main1',{4:'error[E1234]: failed'}), 'blocked');
  assert.equal(retryDecision([cancelled,failed], 'candidate','main1',{4:'HTTP 503'}), 'dispatch');
});
test('read retries are bounded and do not retry authorization errors', async () => {
  let attempts=0;
  await assert.rejects(retryRead(() => {attempts++; throw Error('HTTP 503');}, async()=>{}));
  assert.equal(attempts,3);
  attempts=0;
  await assert.rejects(retryRead(() => {attempts++; throw Error('HTTP 403');}, async()=>{}));
  assert.equal(attempts,1);
});
test('maintenance failures are reported, while transient network failures are not', () => {
  assert.equal(isMaintenanceFailure('Customization patch needs maintenance for v1.3.81'), true);
  assert.equal(isMaintenanceFailure('Unrecognized external binary layout'), true);
  assert.equal(isMaintenanceFailure('Literal target must occur exactly once'), true);
  assert.equal(isMaintenanceFailure('HTTP 503 from GitHub'), false);
  assert.equal(isMaintenanceFailure('TLS handshake timeout'), false);
});
