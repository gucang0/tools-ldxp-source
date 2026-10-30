const fs = require('node:fs');
const path = require('node:path');

const LEGACY_SIDECAR = '../sidecars/cockpit-cliproxy/bin/cockpit-cliproxy';

function inspectBuildLayout(config, exists) {
  if (!config || !config.bundle || typeof config.bundle !== 'object') throw Error('Missing Tauri bundle configuration');
  const binaries = config.bundle.externalBin ?? [];
  if (!Array.isArray(binaries) || (binaries.length !== 0 && (binaries.length !== 1 || binaries[0] !== LEGACY_SIDECAR))) {
    throw Error('Unrecognized external binary layout; adapt the build and package inspection before publishing');
  }
  const needsGoSidecar = binaries.length === 1;
  const hasGoMod = exists('sidecars/cockpit-cliproxy/go.mod');
  const hasGoSum = exists('sidecars/cockpit-cliproxy/go.sum');
  if (hasGoMod !== needsGoSidecar || hasGoSum !== needsGoSidecar) {
    throw Error('Legacy sidecar source and Tauri externalBin disagree; refusing an incomplete or stale package');
  }
  return { needsGoSidecar };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '../..');
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    const layout = inspectBuildLayout(config, file => fs.existsSync(path.join(root, file)));
    process.stdout.write(String(layout.needsGoSidecar) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { LEGACY_SIDECAR, inspectBuildLayout };
