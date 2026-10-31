const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function git(root, args, { trim = true, ...options } = {}) {
  const output = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options });
  return trim ? output.trimEnd() : output;
}

// Exact, scoped replacements tolerate unrelated upstream edits, not changed targets.
function replaceLiterals(content, replacements, file) {
  if (!Array.isArray(replacements) || replacements.length === 0) throw Error(`Missing literal replacements: ${file}`);
  const seen = new Set();
  const edits = replacements.map(({ from, to }) => {
    if (typeof from !== 'string' || !from || typeof to !== 'string' || !to || from === to || seen.has(from)) {
      throw Error(`Invalid literal replacement: ${file}`);
    }
    seen.add(from);
    const start = content.indexOf(from);
    if (start < 0 || content.indexOf(from, start + 1) >= 0) {
      throw Error(`Literal target must occur exactly once in ${file}: ${JSON.stringify(from)}; upstream adaptation required`);
    }
    return { start, end: start + from.length, to };
  }).sort((a, b) => a.start - b.start);
  if (edits.some((edit, i) => i > 0 && edit.start < edits[i - 1].end)) throw Error(`Overlapping literal replacements: ${file}`);
  // Apply against the original bytes, so one replacement cannot feed another.
  for (const { start, end, to } of edits.reverse()) content = content.slice(0, start) + to + content.slice(end);
  return content;
}

function validateRepositoryPolicy(policy) {
  const repositories = policy.repositories || {};
  if (!policy.repositories) return { official: 'jlcodes99/cockpit-tools', release: 'gucang0/tools', source: 'gucang0/tools-ldxp-source' };
  const official = repositories.official || 'jlcodes99/cockpit-tools';
  const release = repositories.release || 'gucang0/tools';
  for (const entry of policy.literalReplacements || []) {
    for (const replacement of entry.replacements || []) {
      if (!replacement.from.includes(official) || !replacement.to.includes(release)) {
        throw Error(`Literal replacement repository drift for ${entry.file}; update repositories and targets together`);
      }
    }
  }
  return { official, release, source: repositories.source || 'gucang0/tools-ldxp-source' };
}

function baseline(version, commit) {
  return `# Upstream Baseline\n\nThis customization is based on the Cockpit Tools ${version} release source.\n\n- Upstream repository: https://github.com/jlcodes99/cockpit-tools\n- Upstream tag: \`v${version}\`\n- Verified source commit: \`${commit}\`\n- License: CC BY-NC-SA 4.0\n\nOnly the top banner is disabled; other announcements, Sponsor features and\nbusiness logic follow upstream. Signed updates use \`gucang0/tools\`.\n`;
}

function officialVersion(root, upstream, version) {
  if (!/^[0-9a-f]{40}$/.test(upstream) || !/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid source identity');
  for (const file of ['package.json', 'src-tauri/tauri.conf.json']) {
    if (JSON.parse(git(root, ['show', `${upstream}:${file}`])).version !== version) throw Error(`Official version mismatch: ${file}`);
  }
  const cargo = git(root, ['show', `${upstream}:src-tauri/Cargo.toml`]);
  if (cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1] !== version) throw Error('Official Cargo version mismatch');
}

// Build a new tree in an isolated index. Never merge old business files into upstream.
function expectedTree(root, upstream, main, version, policyOverride) {
  officialVersion(root, upstream, version);
  const policy = policyOverride || JSON.parse(git(root, ['show', `${main}:scripts/release/customization-policy.json`]));
  validateRepositoryPolicy(policy);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
  const indexed = (args, options = {}) => git(root, args, { env, ...options });
  try {
    indexed(['read-tree', upstream]);
    const workflows = indexed(['ls-files', '.github/workflows']).split('\n').filter(Boolean);
    if (workflows.length) indexed(['update-index', '--force-remove', '--', ...workflows]);
    const ownedWorkflows = git(root, ['ls-tree', '-r', '--name-only', main, '--', '.github/workflows']).split('\n').filter(Boolean);
    for (const file of [...policy.ownedFiles, ...ownedWorkflows]) {
      if (file.includes('..') || path.isAbsolute(file) || policy.runtimeFiles.includes(file)) throw Error(`Unsafe owned path: ${file}`);
      const entry = git(root, ['ls-tree', main, '--', file]);
      const match = entry.match(/^(100644|100755) blob ([0-9a-f]{40})\t/);
      if (!match) throw Error(`Missing repository-owned file: ${file}`);
      indexed(['update-index', '--add', '--cacheinfo', `${match[1]},${match[2]},${file}`]);
    }
    const patch = git(root, ['show', `${main}:${policy.patch}`]) + '\n';
    const changed = [...patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map(m => {
      if (m[1] !== m[2]) throw Error('Renaming runtime files requires explicit adaptation');
      return m[1];
    });
    const literalFiles = policy.literalReplacements || [];
    const scope = [...changed, ...literalFiles.map(entry => entry.file)];
    if (scope.some(file => typeof file !== 'string' || file.includes('..') || file.includes('\\') || path.isAbsolute(file)) ||
        new Set(scope).size !== scope.length ||
        JSON.stringify([...scope].sort()) !== JSON.stringify([...policy.runtimeFiles].sort())) {
      throw Error('Patch/literal scope differs from runtime policy (files must be disjoint)');
    }
    try {
      indexed(['apply', '--cached', '--check', '--whitespace=nowarn', '-'], { input: patch });
      indexed(['apply', '--cached', '--whitespace=nowarn', '-'], { input: patch });
    } catch (error) {
      throw Error(`Customization patch needs maintenance for v${version}; no candidate will be published.\n${error.message}`);
    }
    for (const { file, replacements } of literalFiles) {
      const entry = git(root, ['ls-tree', upstream, '--', file]);
      const mode = entry.match(/^(100644|100755) blob [0-9a-f]{40}\t/)?.[1];
      if (!mode) throw Error(`Missing regular upstream file for literal replacements: ${file}`);
      const original = git(root, ['show', `${upstream}:${file}`], { trim: false });
      const customized = replaceLiterals(original, replacements, file);
      const replacementBlob = git(root, ['hash-object', '-w', '--stdin'], { input: customized });
      indexed(['update-index', '--add', '--cacheinfo', `${mode},${replacementBlob},${file}`]);
    }
    const blob = git(root, ['hash-object', '-w', '--stdin'], { input: baseline(version, upstream) });
    indexed(['update-index', '--add', '--cacheinfo', `100644,${blob},UPSTREAM.md`]);
    return indexed(['write-tree']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function prepareCandidate(root, upstream, main, version, previous) {
  const tree = expectedTree(root, upstream, main, version);
  if (previous && git(root, ['rev-parse', `${previous}^{tree}`]) === tree) {
    try { git(root, ['merge-base', '--is-ancestor', main, previous]); return previous; } catch {}
  }
  const parents = [...new Set([main, upstream, previous].filter(Boolean))];
  return git(root, ['commit-tree', tree, ...parents.flatMap(p => ['-p', p]), '-m', `ci: prepare official v${version} with top banner and updater patches`]);
}

module.exports = { git, baseline, officialVersion, replaceLiterals, validateRepositoryPolicy, expectedTree, prepareCandidate };
