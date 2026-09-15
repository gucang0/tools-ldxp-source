#!/usr/bin/env node

const path = require('node:path');

function normalizeRepositoryPath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Conflict path is required');
  }
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new Error('Conflict path contains invalid characters');
  }
  const normalized = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Conflict path must be repository-relative: ${value}`);
  }
  return normalized;
}

function isOfficialTestPath(relativePath) {
  if (relativePath.startsWith('scripts/release/')) return false;
  const fileName = path.posix.basename(relativePath);
  return (
    /(^|\/)__tests__\//i.test(relativePath) ||
    /(^|\/)tests?\//i.test(relativePath) ||
    /\.(test|spec)\.(cjs|mjs|js|jsx|ts|tsx)$/i.test(fileName) ||
    /_tests?\.(go|rs)$/i.test(fileName)
  );
}

function classifyUpstreamConflict(value) {
  const relativePath = normalizeRepositoryPath(value);
  if (relativePath.startsWith('.github/workflows/')) return 'repository';
  if (isOfficialTestPath(relativePath)) return 'upstream';
  return 'block';
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1) throw new Error('Expected exactly one conflict path');
    process.stdout.write(`${classifyUpstreamConflict(args[0])}\n`);
  } catch (error) {
    console.error(`[classify_upstream_conflict] ${error.message}`);
    process.exit(1);
  }
}

module.exports = { classifyUpstreamConflict, isOfficialTestPath };
