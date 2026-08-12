#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { TARGET_SPECS } = require('./build_target_latest_json.cjs');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    result[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function required(args, key) {
  if (!args[key]) throw new Error(`Missing --${key}`);
  return args[key];
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateEntry(entry, options, target) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Missing updater entry for ${target}`);
  }
  if (typeof entry.signature !== 'string' || entry.signature.trim() === '') {
    throw new Error(`Missing signature for ${target}`);
  }
  const url = new URL(entry.url);
  const expectedPrefix = `https://github.com/${options.repo}/releases/download/v${options.version}/`;
  if (!url.href.startsWith(expectedPrefix)) {
    throw new Error(`Unexpected release URL for ${target}: ${url.href}`);
  }
  const assetName = decodeURIComponent(path.posix.basename(url.pathname));
  if (!TARGET_SPECS[target]?.test(assetName)) {
    throw new Error(`Asset ${assetName} does not match ${target}`);
  }
  const assetPath = path.join(options.assetsDir, assetName);
  const signaturePath = `${assetPath}.sig`;
  if (!fs.existsSync(assetPath) || fs.statSync(assetPath).size === 0) {
    throw new Error(`Missing or empty release asset: ${assetName}`);
  }
  if (!fs.existsSync(signaturePath)) {
    throw new Error(`Missing signature file: ${assetName}.sig`);
  }
  const signature = fs.readFileSync(signaturePath, 'utf8').trim();
  if (signature !== entry.signature.trim()) {
    throw new Error(`Manifest signature differs from ${assetName}.sig`);
  }
  return { assetName, signature };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    version: required(args, 'version'),
    repo: required(args, 'repo'),
    assetsDir: path.resolve(required(args, 'assets-dir')),
    manifestsDir: path.resolve(required(args, 'manifests-dir')),
    legacyPath: path.resolve(required(args, 'legacy')),
    targets: required(args, 'targets').split(',').map((item) => item.trim()).filter(Boolean),
  };

  const targetEntries = new Map();
  for (const target of options.targets) {
    const manifest = loadJson(path.join(options.manifestsDir, `latest-${target}.json`));
    if (manifest.version !== options.version) {
      throw new Error(`Version mismatch in target manifest ${target}`);
    }
    targetEntries.set(target, validateEntry(manifest, options, target));
  }

  const legacy = loadJson(options.legacyPath);
  if (legacy.version !== options.version || !legacy.platforms) {
    throw new Error('Invalid legacy latest.json');
  }
  for (const target of options.targets) {
    validateEntry(legacy.platforms[target], options, target);
  }
  for (const legacyTarget of ['darwin-aarch64', 'darwin-x86_64']) {
    const entry = legacy.platforms[legacyTarget];
    if (!entry || entry.url !== legacy.platforms['darwin-universal'].url) {
      throw new Error(`${legacyTarget} does not point to the Universal updater archive`);
    }
  }
  if (legacy.platforms['windows-x86_64']?.url !== legacy.platforms['windows-x86_64-msi']?.url) {
    throw new Error('Legacy Windows target does not point to the MSI updater asset');
  }

  console.log(`Validated ${options.targets.length} target manifests and legacy latest.json for ${options.version}`);
}

try {
  main();
} catch (error) {
  console.error(`[verify_local_release_candidate] ${error.message}`);
  process.exit(1);
}
