import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ROOT } from '../lib/paths.mjs';

// Isolated from the user's git config: no signing, fixed identity.
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();

/** A dev repo with v0.1.0 and v0.2.0, and a deployment cloned at v0.1.0. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'email-ops-update-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const dev = join(dir, 'dev');
  const deploy = join(dir, 'deploy');
  mkdirSync(join(dev, 'lib'), { recursive: true });
  for (const file of ['update.mjs', 'doctor.mjs', '.gitignore', 'lib/paths.mjs', 'lib/himalaya.mjs']) cpSync(join(ROOT, file), join(dev, file));
  writeFileSync(join(dev, 'VERSION'), '0.1.0\n');
  git(dev, 'init', '-q', '-b', 'main');
  git(dev, 'add', '-A');
  git(dev, 'commit', '-q', '-m', 'v0.1.0');
  git(dev, 'tag', 'v0.1.0');
  git(dir, 'clone', '-q', dev, deploy);
  git(deploy, 'checkout', '-q', '--detach', 'v0.1.0');
  writeFileSync(join(dev, 'VERSION'), '0.2.0\n');
  git(dev, 'commit', '-q', '-am', 'v0.2.0');
  git(dev, 'tag', 'v0.2.0');
  return { dev, deploy };
}

const update = (cwd) =>
  spawnSync(process.execPath, ['update.mjs'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', EMAIL_OPS_HIMALAYA_BIN: '/nonexistent' },
  });

test('update moves a deployment to the newest tag and keeps personal files', () => {
  const { deploy } = setup();
  mkdirSync(join(deploy, 'data'));
  writeFileSync(join(deploy, 'data', 'actions.jsonl'), '{"mine":true}\n');
  mkdirSync(join(deploy, 'modes'));
  writeFileSync(join(deploy, 'modes', '_profile.md'), 'my profile\n');
  const r = update(deploy);
  assert.match(r.stdout, /Updated v0\.1\.0 → v0\.2\.0/, r.stderr);
  assert.equal(readFileSync(join(deploy, 'VERSION'), 'utf8'), '0.2.0\n');
  assert.equal(readFileSync(join(deploy, 'data', 'actions.jsonl'), 'utf8'), '{"mine":true}\n');
  assert.equal(readFileSync(join(deploy, 'modes', '_profile.md'), 'utf8'), 'my profile\n');
});

test('update refuses when tracked files were edited in the deployment', () => {
  const { deploy } = setup();
  writeFileSync(join(deploy, 'VERSION'), 'hand edit\n');
  const r = update(deploy);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /VERSION/);
  assert.equal(readFileSync(join(deploy, 'VERSION'), 'utf8'), 'hand edit\n');
});

test('update refuses to run in the dev repo', () => {
  const { dev } = setup();
  const r = update(dev);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /looks like the dev repo/);
  assert.ok(existsSync(join(dev, 'VERSION')));
});
