const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, expectedTree, prepareCandidate } = require('./prepare_candidate.cjs');

test('official tree replacement preserves workflows, restores tests and fast-forwards retries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-candidate-test-'));
  const write = (p, content) => { fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true}); fs.writeFileSync(path.join(root,p),content); };
  const commit = message => {git(root,['add','.']);git(root,['commit','-m',message]);return git(root,['rev-parse','HEAD']);};
  try {
    git(root,['init']); git(root,['config','user.name','test']); git(root,['config','user.email','test@example.invalid']);git(root,['config','core.autocrlf','false']);
    write('package.json','{"version":"1.2.3"}\n');
    write('src-tauri/tauri.conf.json','{"version":"1.2.3"}\n');
    write('src-tauri/Cargo.toml','[package]\nversion = "1.2.3"\n');
    write('app.txt','official ad\n');write('sidecar.txt','official sidecar\n');
    write('ordinary.test.ts','official test\n');write('.github/workflows/release.yml','official workflow\n');
    const upstream = commit('official');
    write('app.txt','old unrelated customization\n');write('sidecar.txt','old sidecar patch\n');
    fs.unlinkSync(path.join(root,'ordinary.test.ts'));fs.unlinkSync(path.join(root,'.github/workflows/release.yml'));
    write('.github/workflows/custom.yml','custom workflow\n');
    write('policy.txt','owned\n');
    write('scripts/release/top-ad-updater.patch','diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-official ad\n+no ad\n');
    const policy={patch:'scripts/release/top-ad-updater.patch',runtimeFiles:['app.txt'],ownedFiles:['policy.txt','scripts/release/customization-policy.json','scripts/release/top-ad-updater.patch']};
    write('scripts/release/customization-policy.json',JSON.stringify(policy));
    const main=commit('old customization');
    const candidate=prepareCandidate(root,upstream,main,'1.2.3');
    assert.equal(git(root,['show',`${candidate}:sidecar.txt`]),'official sidecar');
    assert.equal(git(root,['show',`${candidate}:ordinary.test.ts`]),'official test');
    assert.equal(git(root,['show',`${candidate}:app.txt`]),'no ad');
    assert.equal(git(root,['show',`${candidate}:.github/workflows/custom.yml`]),'custom workflow');
    assert.throws(()=>git(root,['show',`${candidate}:.github/workflows/release.yml`]));
    assert.equal(prepareCandidate(root,upstream,main,'1.2.3',candidate),candidate);
    assert.equal(git(root,['rev-parse','HEAD']),main);
    assert.equal(git(root,['status','--porcelain']),'');
    write('policy.txt','repaired workflow\n'); const repaired=commit('repair');
    const next=prepareCandidate(root,upstream,repaired,'1.2.3',candidate);
    git(root,['merge-base','--is-ancestor',candidate,next]);
    git(root,['merge-base','--is-ancestor',repaired,next]);
    assert.notEqual(next,candidate);
    assert.throws(()=>expectedTree(root,upstream,repaired,'9.9.9'));
    assert.throws(()=>expectedTree(root,upstream,repaired,'1.2.3',{...policy,runtimeFiles:['sidecar.txt']}));
    git(root,['checkout','--detach',upstream]);write('app.txt','refactored upstream\n');const changed=commit('upstream refactor');
    assert.throws(()=>expectedTree(root,changed,repaired,'1.2.3'));
    assert.equal(git(root,['status','--porcelain']),'');
  } finally {
    if (!root.startsWith(path.join(os.tmpdir(),'cockpit-candidate-test-'))) throw Error('Unsafe fixture cleanup');
    fs.rmSync(root,{recursive:true,force:true});
  }
});
