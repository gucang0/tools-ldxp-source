const { spawnSync } = require('node:child_process');

function isTransientFailure(output) {
  return /http status:\s*(408|429|5\d\d)|ECONNRESET|ETIMEDOUT|EAI_AGAIN|error sending request|connection reset|timed out|dns error/i.test(output);
}

async function bundleWithRetry(run, { sleep, log = console.log, attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = run();
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    log(output);
    if (result.error) throw result.error;
    if (result.status === 0) return;
    if (attempt === attempts || !isTransientFailure(output)) throw new Error(`Tauri bundling failed (exit ${result.status})`);
    log(`Transient packaging failure; retry ${attempt + 1}/${attempts} without rebuilding the application`);
    await sleep(5000 * attempt);
  }
}

if (require.main === module) {
  bundleWithRetry(() => spawnSync(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), 'bundle', ...process.argv.slice(2)], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }), { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }).catch((error) => {
    console.error(`[bundle_with_retry] ${error.message}`);
    process.exitCode = 1;
  });
}
module.exports = { bundleWithRetry, isTransientFailure };
