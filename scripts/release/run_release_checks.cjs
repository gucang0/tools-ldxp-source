const { spawnSync } = require('node:child_process');
const path = require('node:path');
const policy = require('./customization-policy.json');
const result = spawnSync(process.execPath, ['--test', ...policy.tests], {
  cwd: path.resolve(__dirname, '../..'), stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
