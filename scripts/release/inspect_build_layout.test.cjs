const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LEGACY_SIDECAR, inspectBuildLayout } = require('./inspect_build_layout.cjs');

test('legacy Go and native-only releases select the appropriate build contract', () => {
  assert.deepEqual(inspectBuildLayout({ bundle: { externalBin: [LEGACY_SIDECAR] } }, () => true), { needsGoSidecar: true });
  assert.deepEqual(inspectBuildLayout({ bundle: {} }, () => false), { needsGoSidecar: false });
  assert.deepEqual(inspectBuildLayout({ bundle: { externalBin: [] } }, () => false), { needsGoSidecar: false });
});

test('unknown or incomplete binary layouts fail closed', () => {
  for (const externalBin of ['unknown', ['new-sidecar'], [LEGACY_SIDECAR, 'new-sidecar'], [LEGACY_SIDECAR, LEGACY_SIDECAR]]) {
    assert.throws(() => inspectBuildLayout({ bundle: { externalBin } }, () => true), /Unrecognized/);
  }
  assert.throws(() => inspectBuildLayout({}, () => false), /Missing/);
  for (const config of [{ bundle: {} }, { bundle: { externalBin: [LEGACY_SIDECAR] } }]) {
    assert.throws(() => inspectBuildLayout(config, file => file.endsWith('go.mod')), /disagree/);
    assert.throws(() => inspectBuildLayout(config, file => file.endsWith('go.sum')), /disagree/);
  }
  assert.throws(() => inspectBuildLayout({ bundle: {} }, () => true), /disagree/);
  assert.throws(() => inspectBuildLayout({ bundle: { externalBin: [LEGACY_SIDECAR] } }, () => false), /disagree/);
});

test('both platform builds and package checks consume the validated source layout', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ldxp-release.yml'), 'utf8');
  assert.match(workflow, /needs_go_sidecar: \$\{\{ steps\.layout\.outputs\.needs_go_sidecar \}\}/);
  assert.match(workflow, /node scripts\/release\/inspect_build_layout\.cjs/);
  assert.equal((workflow.match(/if: \$\{\{ needs\.validate\.outputs\.needs_go_sidecar == 'true' \}\}/g) || []).length, 2);
  assert.equal((workflow.match(/EXPECT_LEGACY_SIDECAR: \$\{\{ needs\.validate\.outputs\.needs_go_sidecar \}\}/g) || []).length, 2);
  assert.match(workflow, /\$sidecars\.Count -ne \$expectedSidecars/);
  assert.match(workflow, /test ! -e "\$\{SIDECAR\}"/);
});
