#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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

const args = parseArgs(process.argv.slice(2));
const version = args.version?.trim();
const commit = args.commit?.trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version || '')) {
  throw new Error(`Invalid --version: ${version || '<empty>'}`);
}
if (!/^[0-9a-f]{40}$/.test(commit || '')) {
  throw new Error(`Invalid --commit: ${commit || '<empty>'}`);
}

const content = `# Upstream Baseline

This customization is based on the Cockpit Tools ${version} release source.

- Upstream repository: https://github.com/jlcodes99/cockpit-tools
- Upstream tag: \`v${version}\`
- Verified source commit: \`${commit}\`
- License: CC BY-NC-SA 4.0

The customization removes top promotional content. It keeps the application
feature set and uses \`gucang0/tools\` as its signed updater channel. The source
and release notes retain the upstream attribution and license.
`;

fs.writeFileSync(path.resolve(__dirname, '..', '..', 'UPSTREAM.md'), content);
console.log(`Updated UPSTREAM.md for Cockpit Tools v${version} (${commit})`);
