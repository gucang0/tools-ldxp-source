const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, replaceLiterals, expectedTree, prepareCandidate } = require('./prepare_candidate.cjs');

test('literal replacements preserve unrelated edits and whitespace without depending on highlights', () => {
  const { file, replacements } = require('./customization-policy.json').literalReplacements[0];
  for (const ending of ['\n', '\r\n']) {
    for (const adjacent of ['const RELEASE_HIGHLIGHTS = {};', 'export interface ParsedUpdaterReleaseNotes {}']) {
      const original = [
        '// 新版上游内容',
        `const tag = ${replacements[0].from};`, adjacent,
        `const latest = ${replacements[1].from};`, '  ', '', '',
      ].join(ending);
      const expected = original.replace(replacements[0].from, replacements[0].to).replace(replacements[1].from, replacements[1].to);
      assert.equal(replaceLiterals(original, replacements, file), expected);
    }
  }
});

test('literal replacements fail closed on missing, ambiguous, overlapping or invalid targets', () => {
  const replacements = [{ from: 'official', to: 'custom' }];
  assert.throws(() => replaceLiterals('refactored', replacements, 'app.ts'), /exactly once.*app.ts/);
  assert.throws(() => replaceLiterals('official official', replacements, 'app.ts'), /exactly once/);
  assert.throws(() => replaceLiterals('aaa', [{ from: 'aa', to: 'b' }], 'app.ts'), /exactly once/);
  assert.throws(() => replaceLiterals('official', [], 'app.ts'), /Missing/);
  for (const replacement of [{ from: '', to: 'x' }, { from: 'official', to: '' }, { from: 'official', to: 'official' }]) {
    assert.throws(() => replaceLiterals('official', [replacement], 'app.ts'), /Invalid/);
  }
  assert.throws(() => replaceLiterals('official', [...replacements, ...replacements], 'app.ts'), /Invalid/);
  assert.throws(() => replaceLiterals('official', [replacements[0], { from: 'ficial', to: 'other' }], 'app.ts'), /Overlapping/);
  assert.equal(replaceLiterals('alpha beta', [{ from: 'alpha', to: 'beta' }, { from: 'beta', to: 'gamma' }], 'app.ts'), 'beta gamma');
});

test('candidate preserves refactored upstream content and enforces disjoint allowlisted literal scope', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-candidate-test-'));
  const write = (p, content) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), content); };
  const commit = message => { git(root, ['add', '.']); git(root, ['commit', '-m', message]); return git(root, ['rev-parse', 'HEAD']); };
  try {
    git(root, ['init']); git(root, ['config', 'user.name', 'test']); git(root, ['config', 'user.email', 'test@example.invalid']); git(root, ['config', 'core.autocrlf', 'false']);
    write('package.json', '{"version":"1.2.3"}\n');
    write('src-tauri/tauri.conf.json', '{"version":"1.2.3"}\n');
    write('src-tauri/Cargo.toml', '[package]\nversion = "1.2.3"\n');
    write('app.txt', 'official ad\n');
    write('notes.ts', "const url = 'official-url';\nconst RELEASE_HIGHLIGHTS = {};\n");
    write('untouched.txt', 'new official business logic\n');
    const oldUpstream = commit('old official');
    const patchPath = 'scripts/release/top-ad-updater.patch';
    const policyPath = 'scripts/release/customization-policy.json';
    write(patchPath, 'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-official ad\n+no ad\n');
    const literal = { file: 'notes.ts', replacements: [{ from: "'official-url'", to: "'custom-url'" }] };
    const policy = { patch: patchPath, runtimeFiles: ['app.txt', 'notes.ts'], literalReplacements: [literal], ownedFiles: [patchPath, policyPath] };
    write(policyPath, JSON.stringify(policy));
    const main = commit('customization policy');
    git(root, ['checkout', '--detach', oldUpstream]);
    const refactored = "// 新的上游代码\nconst url = 'official-url';\nexport interface Notes {}\n  \n\n";
    write('notes.ts', refactored);
    const upstream = commit('remove old highlights');
    const candidate = prepareCandidate(root, upstream, main, '1.2.3');
    assert.equal(git(root, ['show', `${candidate}:notes.ts`], { trim: false }), refactored.replace("'official-url'", "'custom-url'"));
    assert.equal(git(root, ['show', `${candidate}:app.txt`]), 'no ad');
    assert.equal(git(root, ['rev-parse', `${candidate}:untouched.txt`]), git(root, ['rev-parse', `${upstream}:untouched.txt`]));
    assert.equal(git(root, ['rev-parse', 'HEAD']), upstream);
    assert.equal(git(root, ['status', '--porcelain']), '');
    assert.equal(prepareCandidate(root, upstream, main, '1.2.3', candidate), candidate);
    for (const invalid of [
      { ...policy, runtimeFiles: ['app.txt'] },
      { ...policy, literalReplacements: [literal, literal] },
      { ...policy, literalReplacements: [{ ...literal, file: 'app.txt' }] },
      { ...policy, runtimeFiles: ['app.txt', '../escape'], literalReplacements: [{ ...literal, file: '../escape' }] },
    ]) assert.throws(() => expectedTree(root, upstream, main, '1.2.3', invalid), /scope differs/);
    assert.throws(() => expectedTree(root, upstream, main, '1.2.3', { ...policy, runtimeFiles: ['app.txt', 'missing.ts'], literalReplacements: [{ ...literal, file: 'missing.ts' }] }), /Missing regular upstream file/);
    write('notes.ts', "// official removed the old link\n");
    const missing = commit('remove link');
    assert.throws(() => prepareCandidate(root, missing, main, '1.2.3'), /exactly once/);
    write('notes.ts', "'official-url'\n'official-url'\n");
    const ambiguous = commit('duplicate link');
    assert.throws(() => prepareCandidate(root, ambiguous, main, '1.2.3'), /exactly once/);
  } finally {
    if (!root.startsWith(path.join(os.tmpdir(), 'cockpit-candidate-test-'))) throw Error('Unsafe fixture cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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
