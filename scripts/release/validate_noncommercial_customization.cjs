#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { git, expectedTree } = require('./prepare_candidate.cjs');

function main() {
  const root = path.resolve(__dirname, '../..');
  const args = process.argv.slice(2);
  const value = name => { const i=args.indexOf(name); return i < 0 ? undefined : args[i+1]; };
  const version = value('--version') || JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  const upstream = value('--upstream') || fs.readFileSync(path.join(root,'UPSTREAM.md'),'utf8').match(/Verified source commit: `([a-f0-9]{40})`/)?.[1];
  const owner = process.env.GITHUB_SHA || 'HEAD';
  const expected = expectedTree(root, upstream, owner, version);
  const actual = git(root, ['rev-parse','HEAD^{tree}']);
  if (actual !== expected) {
    throw Error(`Source differs from official + approved patches:\n${git(root,['diff','--name-status',expected,actual])}`);
  }
  const config=JSON.parse(git(root,['show','HEAD:src-tauri/tauri.conf.json']));
  const expectedEndpoints = [
    'https://github.com/gucang0/tools/releases/latest/download/latest-{{target}}.json',
    'https://github.com/gucang0/tools/releases/latest/download/latest.json',
  ];
  if (config.version !== version || JSON.stringify(config.plugins?.updater?.endpoints) !== JSON.stringify(expectedEndpoints)) throw Error('Version or updater channel mismatch');
  const signingKey='dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IERCMENFOEIyMDQ5OTBFQkUKUldTK0Rwa0VzdWdNMnhQS3NpSy9UWDF6VWxheUl2WTZYMzVuc2NGUUJubEYrakQ1VFE5SEp6eTQK';
  if(config.plugins.updater.pubkey !== signingKey) throw Error('Existing updater key changed; old-client compatibility would break');
  const release=JSON.parse(git(root,['show','HEAD:src-tauri/tauri.release.conf.json']));
  if(release.build?.beforeBuildCommand !== '' || release.bundle?.createUpdaterArtifacts !== false) throw Error('Release must reuse verified frontend and isolated signing');
  console.log(`Validated exact official source + top-banner/updater patches for ${version}`);
}
if(require.main===module)try{main();}catch(error){console.error(error.message);process.exitCode=1;}
