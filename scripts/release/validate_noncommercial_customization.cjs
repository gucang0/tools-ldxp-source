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
}

function validateRuntimeCustomization() {
  const tauriAnnouncement = read('src-tauri/src/modules/announcement.rs');
  const coreAnnouncement = read('crates/cockpit-core/src/modules/announcement.rs');
  const remoteConfig = read('src-tauri/src/modules/remote_config.rs');
  const adStore = read('src/stores/useTopRightAdStore.ts');
  const app = read('src/App.tsx');
  const settings = read('src/pages/SettingsPage.tsx');
  const updaterNotes = read('src/utils/updaterReleaseNotes.ts');

  requireText(tauriAnnouncement, 'top_right_ads_enabled: false', 'Tauri announcement module');
  requireText(tauriAnnouncement, 'sponsor_module: None', 'Tauri announcement module');
  requireText(tauriAnnouncement, 'pub async fn get_top_right_ad_state()', 'Tauri announcement module');
  requireText(coreAnnouncement, 'top_right_ad: None', 'Core announcement module');
  requireText(coreAnnouncement, 'top_right_ads: Vec::new()', 'Core announcement module');
  requireText(
    remoteConfig,
    'raw.githubusercontent.com/jlcodes99/cockpit-tools/main/remote-config.json',
    'Official remote update policy',
  );
  requireText(adStore, "'agtools.top_right_ad_state.cache.v1'", 'Top promotion store');
  requireText(adStore, "'agtools.top_right_ad_state.cache.v2'", 'Top promotion store');
  requireText(app, "@tauri-apps/plugin-updater", 'Application updater');
  requireText(app, 'const runUpdaterCheck', 'Application updater');
  requireText(app, "'update-check-requested'", 'Application updater');
  requireText(settings, 'handleCheckUpdate', 'Settings update entry');
  requireText(settings, 'Unofficial modified build', 'About page attribution');
  requireText(settings, 'creativecommons.org/licenses/by-nc-sa/4.0/', 'About page license');
  requireText(updaterNotes, 'https://github.com/gucang0/tools/releases/', 'Updater release notes');

  const runtimeSources = [tauriAnnouncement, coreAnnouncement, remoteConfig, adStore, app];
  const forbidden = [
    'raw.githubusercontent.com/jlcodes99/cockpit-tools/main/announcements.json',
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
