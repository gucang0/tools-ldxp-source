const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { buildTargetManifests } = require('./build_target_latest_json.cjs');

test('validates Windows, Universal macOS, and legacy updater mappings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ldxp-local-candidate-'));
  const assetsDir = path.join(root, 'assets');
  const manifestsDir = path.join(root, 'manifests');
  const notesFile = path.join(root, 'notes.md');
  const legacyFile = path.join(root, 'latest.json');
  const version = '1.2.3';
  const repo = 'gucang0/tools';
  const targets = [
    'windows-x86_64-msi',
    'windows-x86_64-nsis',
    'darwin-universal',
    'darwin-aarch64-app',
    'darwin-x86_64-app',
  ];
  const assets = [
    'Cockpit.Tools_1.2.3_x64_en-US.msi',
    'Cockpit.Tools_1.2.3_x64-setup.exe',
    'Cockpit.Tools_1.2.3_universal.app.tar.gz',
  ];

  fs.mkdirSync(assetsDir);
  fs.writeFileSync(notesFile, 'Unofficial noncommercial build');
  for (const asset of assets) {
    fs.writeFileSync(path.join(assetsDir, asset), `payload-${asset}`);
    fs.writeFileSync(path.join(assetsDir, `${asset}.sig`), `signature-${asset}`);
  }
  buildTargetManifests({
    version,
    repo,
    assetsDir,
    notesFile,
    publishedAt: '2026-08-12T00:00:00Z',
    outputDir: manifestsDir,
    targets,
  });

  const manifests = Object.fromEntries(
    targets.map((target) => [
      target,
      JSON.parse(fs.readFileSync(path.join(manifestsDir, `latest-${target}.json`), 'utf8')),
    ]),
  );
  const platforms = Object.fromEntries(
    Object.entries(manifests).map(([target, manifest]) => [
      target,
      { url: manifest.url, signature: manifest.signature },
    ]),
  );
  platforms['darwin-aarch64'] = { ...platforms['darwin-universal'] };
  platforms['darwin-x86_64'] = { ...platforms['darwin-universal'] };
  platforms['windows-x86_64'] = { ...platforms['windows-x86_64-msi'] };
  fs.writeFileSync(legacyFile, JSON.stringify({ version, notes: 'notes', platforms }));

  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'verify_local_release_candidate.cjs'),
    '--version', version,
    '--repo', repo,
    '--assets-dir', assetsDir,
    '--manifests-dir', manifestsDir,
    '--legacy', legacyFile,
    '--targets', targets.join(','),
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 5 target manifests/);
});
