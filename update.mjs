#!/usr/bin/env node
// Move a deployment to the newest release tag from its origin (the dev repo).
//
//   npm run update                 newest v* tag
//   npm run update -- --ref v0.2.0 a specific tag (or a branch, e.g. main)
//
// A checkout only rewrites tracked files, and everything personal is gitignored
// (config/himalaya.toml, modes/_profile.md, data/), so an update never touches
// it. Edited tracked files would be overwritten, so they stop the update.

import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ROOT } from './lib/paths.mjs';

const { values } = parseArgs({ options: { ref: { type: 'string' } } });
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();

function fail(message) {
  console.error(`update: ${message}`);
  process.exit(1);
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'HEAD') {
  fail(`this checkout is on branch "${branch}", which looks like the dev repo. Updates run in a deployment (detached at a release tag).`);
}

const modified = git('status', '--porcelain', '--untracked-files=no');
if (modified) {
  fail(`tracked files were edited here and an update would overwrite them:\n${modified}\n` +
    'Move personal changes into modes/_profile.md (or make them in the dev repo), then `git checkout -- <file>`.');
}

try {
  git('fetch', '--tags', '--prune', 'origin');
} catch (err) {
  fail(`could not fetch from origin: ${err.stderr?.toString().trim() || err.message}`);
}

let target = values.ref;
if (!target) {
  target = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n')[0];
  if (!target) fail('origin has no v* release tags yet');
}
const isTag = git('tag', '--list', target) === target;
const commit = git('rev-parse', '--verify', `${isTag ? target : `origin/${target}`}^{commit}`);
const current = git('rev-parse', 'HEAD');
const from = git('describe', '--tags', '--always');

if (commit === current) {
  console.log(`Already at ${target}.`);
} else {
  git('checkout', '--quiet', '--detach', commit);
  console.log(`Updated ${from} → ${target}.`);
}

spawnSync(process.execPath, ['doctor.mjs'], { cwd: ROOT, stdio: 'inherit' });
