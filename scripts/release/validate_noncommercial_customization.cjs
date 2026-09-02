#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
  throw new Error(message);
}

function requireText(content, expected, label) {
  if (!content.includes(expected)) {
    fail(`${label} is missing required text: ${expected}`);
  }
}

function forbidText(content, forbidden, label) {
  if (content.includes(forbidden)) {
    fail(`${label} contains forbidden text: ${forbidden}`);
  }
}

function functionSection(content, signature, nextSignature, label) {
  const start = content.indexOf(signature);
  if (start < 0) {
    fail(`${label} is missing function: ${signature}`);
  }
  const end = content.indexOf(nextSignature, start + signature.length);
  if (end < 0) {
    fail(`${label} is missing function boundary: ${nextSignature}`);
  }
  return content.slice(start, end);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function validateVersion(expectedVersion) {
  const packageJson = JSON.parse(read('package.json'));
  const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'));
  const releaseConfig = JSON.parse(read('src-tauri/tauri.release.conf.json'));
  const cargoToml = read('src-tauri/Cargo.toml');
  const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

  for (const [label, actual] of [
    ['package.json', packageJson.version],
    ['tauri.conf.json', tauriConfig.version],
    ['src-tauri/Cargo.toml', cargoVersion],
  ]) {
    if (actual !== expectedVersion) {
      fail(`${label} version mismatch: expected ${expectedVersion}, got ${actual}`);
    }
  }

  const updater = tauriConfig.plugins?.updater;
  if (!updater || typeof updater.pubkey !== 'string' || updater.pubkey.trim() === '') {
    fail('Tauri updater public key is missing');
  }
  const expectedEndpoints = [
    'https://github.com/gucang0/tools/releases/latest/download/latest-{{target}}.json',
    'https://github.com/gucang0/tools/releases/latest/download/latest.json',
  ];
  if (JSON.stringify(updater.endpoints) !== JSON.stringify(expectedEndpoints)) {
    fail(`Unexpected updater endpoints: ${JSON.stringify(updater.endpoints)}`);
  }
  if (tauriConfig.bundle?.createUpdaterArtifacts !== true) {
    fail('createUpdaterArtifacts must remain enabled');
  }
  if (releaseConfig.build?.beforeBuildCommand !== '') {
    fail('Release builds must reuse the validated frontend artifact');
  }
  if (releaseConfig.bundle?.createUpdaterArtifacts !== false) {
    fail('Release builds must keep automatic updater artifact generation disabled');
  }
}

function validateRuntimeCustomization() {
  const tauriAnnouncement = read('src-tauri/src/modules/announcement.rs');
  const coreAnnouncement = read('crates/cockpit-core/src/modules/announcement.rs');
  const remoteConfig = read('src-tauri/src/modules/remote_config.rs');
  const adStore = read('src/stores/useTopRightAdStore.ts');
  const app = read('src/App.tsx');
  const settings = read('src/pages/SettingsPage.tsx');
  const updaterNotes = read('src/utils/updaterReleaseNotes.ts');
  const syncWorkflow = read('.github/workflows/upstream-sync.yml');
  const releaseWorkflow = read('.github/workflows/ldxp-release.yml');

  const tauriAnnouncementState = functionSection(
    tauriAnnouncement,
    'pub async fn get_announcement_state()',
    'pub async fn get_top_right_ad_state()',
    'Tauri announcement module',
  );
  const tauriTopPromotion = functionSection(
    tauriAnnouncement,
    'pub async fn get_top_right_ad_state()',
    'pub async fn get_sponsor_module_state()',
    'Tauri announcement module',
  );
  const tauriSponsor = functionSection(
    tauriAnnouncement,
    'pub async fn get_sponsor_module_state()',
    'pub async fn force_refresh_sponsor_module()',
    'Tauri announcement module',
  );
  const coreAnnouncementState = functionSection(
    coreAnnouncement,
    'pub async fn get_announcement_state()',
    'pub async fn get_top_right_ad_state()',
    'Core announcement module',
  );
  const coreTopPromotion = functionSection(
    coreAnnouncement,
    'pub async fn get_top_right_ad_state()',
    'pub async fn mark_announcement_as_read',
    'Core announcement module',
  );

  requireText(tauriAnnouncement, 'ANNOUNCEMENT_URL', 'Tauri announcement module');
  requireText(tauriAnnouncementState, 'filter_announcements(raw_payload.announcements', 'Tauri announcement state');
  requireText(tauriTopPromotion, 'ad: None', 'Tauri top promotion state');
  requireText(tauriTopPromotion, 'ads: Vec::new()', 'Tauri top promotion state');
  forbidText(tauriTopPromotion, 'load_announcements_raw', 'Tauri top promotion state');
  requireText(tauriSponsor, 'filter_sponsor_module(raw_payload.sponsor_module', 'Tauri Sponsor state');
  requireText(coreAnnouncementState, 'filter_announcements(raw_payload.announcements', 'Core announcement state');
  requireText(coreTopPromotion, 'ad: None', 'Core top promotion state');
  requireText(coreTopPromotion, 'ads: Vec::new()', 'Core top promotion state');
  forbidText(coreTopPromotion, 'load_announcements_raw', 'Core top promotion state');
  requireText(
    remoteConfig,
    'raw.githubusercontent.com/jlcodes99/cockpit-tools/main/remote-config.json',
    'Official remote update policy',
  );
  requireText(adStore, "'agtools.top_right_ad_state.cache.v1'", 'Top promotion store');
  requireText(adStore, "'agtools.top_right_ad_state.cache.v2'", 'Top promotion store');
  forbidText(adStore, 'localStorage.getItem', 'Top promotion store');
  forbidText(adStore, 'localStorage.setItem', 'Top promotion store');
  requireText(app, "@tauri-apps/plugin-updater", 'Application updater');
  requireText(app, 'const runUpdaterCheck', 'Application updater');
  requireText(app, "'update-check-requested'", 'Application updater');
  requireText(settings, 'handleCheckUpdate', 'Settings update entry');
  requireText(updaterNotes, 'https://github.com/gucang0/tools/releases/', 'Updater release notes');
  requireText(syncWorkflow, 'Check Official Release Every 6 Hours', 'Upstream sync schedule');
  requireText(syncWorkflow, "cron: '17 */6 * * *'", 'Upstream sync schedule');
  forbidText(syncWorkflow, 'CHECK_ANCHOR_EPOCH', 'Upstream sync schedule');
  requireText(syncWorkflow, "sed '/^\\.github\\/workflows\\//d'", 'Upstream workflow isolation');
  requireText(syncWorkflow, '.github/workflows/*)', 'Upstream workflow conflict isolation');
  requireText(
    syncWorkflow,
    'A Cockpit Tools release is already active',
    'Cross-version release serialization',
  );
  requireText(releaseWorkflow, 'name: frontend-dist', 'Release workflow frontend artifact');
  requireText(releaseWorkflow, 'cache-workspace-crates: false', 'Release workflow Rust cache');
  requireText(
    releaseWorkflow,
    "save-if: ${{ github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/heads/automation/candidate-v') }}",
    'Release workflow Rust cache',
  );
  requireText(releaseWorkflow, 'HEAD:.github/workflows', 'Release workflow isolation');
  requireText(releaseWorkflow, 'lipo "${SIDECAR}" -verify_arch x86_64 arm64', 'Universal sidecar validation');
  requireText(releaseWorkflow, "'cockpit-cliproxy.exe'", 'Windows sidecar validation');
  requireText(releaseWorkflow, 'trap cleanup_failed_draft EXIT', 'Draft cleanup');
  requireText(releaseWorkflow, '(failure() || cancelled())', 'Cancellation rollback');
  requireText(
    releaseWorkflow,
    'src-tauri/tauri.release.conf.json',
    'Release workflow configuration',
  );
  forbidText(
    releaseWorkflow,
    'src-tauri/tauri.ci.conf.json',
    'Release workflow configuration',
  );

  const forbiddenBuildLabels = [
    String.fromCodePoint(0x975e, 0x5b98, 0x65b9),
    ['unoff', 'icial'].join(''),
    ['modified', 'build'].join(' '),
  ];
  const publicMetadataSources = [
    ['About page', settings],
    ['Release workflow', read('.github/workflows/ldxp-release.yml')],
    ['Upstream sync workflow', syncWorkflow],
    ['Modifications document', read('MODIFICATIONS.md')],
    ['Upstream baseline document', read('UPSTREAM.md')],
    ['Upstream baseline template', read('scripts/release/update_upstream_baseline.cjs')],
  ];
  for (const value of forbiddenBuildLabels) {
    for (const [label, content] of publicMetadataSources) {
      forbidText(content.toLowerCase(), value.toLowerCase(), label);
    }
  }

  const runtimeSources = [remoteConfig, adStore, app];
  const forbidden = [
    'raw.githubusercontent.com/gucang0/tools/main/promotion.json',
    'pay.ldxp.cn',
    '854760178',
    '850r plus',
  ];
  for (const value of forbidden) {
    for (const [index, content] of runtimeSources.entries()) {
      forbidText(content, value, `runtime source ${index + 1}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageVersion = JSON.parse(read('package.json')).version;
  const expectedVersion = args.version || packageVersion;
  validateVersion(expectedVersion);
  validateRuntimeCustomization();
  console.log(`Validated noncommercial customization for Cockpit Tools ${expectedVersion}`);
}

try {
  main();
} catch (error) {
  console.error(`[validate_noncommercial_customization] ${error.message}`);
  process.exit(1);
}
