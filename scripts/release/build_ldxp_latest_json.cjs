#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const TARGETS = [
  'darwin-aarch64-app',
  'darwin-x86_64-app',
  'windows-x86_64-msi',
  'windows-x86_64-nsis',
];

function requiredArg(args, key) {
  const value = args[key];
  if (!value) throw new Error(`Missing required argument --${key}`);
  return value;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function readManifest(directory, target, version) {
  const filePath = path.join(directory, `latest-${target}.json`);
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (manifest.version !== version || !manifest.url || !manifest.signature) {
    throw new Error(`Invalid updater manifest for ${target}`);
  }
  return { url: manifest.url, signature: manifest.signature };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = requiredArg(args, 'version');
  const manifestsDir = requiredArg(args, 'manifests-dir');
  const notesPath = requiredArg(args, 'notes-file');
  const outputPath = requiredArg(args, 'output');
  const notes = fs.readFileSync(notesPath, 'utf8').trim();
  const platforms = Object.fromEntries(
    TARGETS.map((target) => [target, readManifest(manifestsDir, target, version)]),
  );

  platforms['darwin-aarch64'] = { ...platforms['darwin-aarch64-app'] };
  platforms['darwin-x86_64'] = { ...platforms['darwin-x86_64-app'] };
  platforms['windows-x86_64'] = { ...platforms['windows-x86_64-msi'] };

  fs.writeFileSync(
    outputPath,
    `${JSON.stringify({ version, notes, platforms }, null, 2)}\n`,
  );
}

try {
  main();
} catch (error) {
  console.error(`[build_ldxp_latest_json] ${error.message}`);
  process.exit(1);
}
