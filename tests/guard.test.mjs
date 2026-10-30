import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ROOT } from '../lib/paths.mjs';

// The hook decides strict vs development from where it lives, so each mode gets
// its own copy of it in a throwaway checkout.
function checkout({ dev }) {
  const dir = mkdtempSync(join(tmpdir(), 'email-ops-guard-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  copyFileSync(join(ROOT, '.claude', 'hooks', 'guard.mjs'), join(dir, '.claude', 'hooks', 'guard.mjs'));
  if (dev) writeFileSync(join(dir, '.claude', 'dev-mode'), '');
  return dir;
}

const strict = checkout({ dev: false });
const dev = checkout({ dev: true });

function run(dir, stdin) {
  const r = spawnSync(process.execPath, [join(dir, '.claude', 'hooks', 'guard.mjs')], { input: stdin, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'none';
}

const call = (dir, tool_name, tool_input) => run(dir, JSON.stringify({ tool_name, tool_input }));
const bash = (dir, command) => call(dir, 'Bash', { command });

const strictCases = {
  deny: [
    'himalaya envelope list',
    '/home/me/.cargo/bin/himalaya message delete 4',
    'HIMALAYA_CONFIG=x himalaya imap expunge',
    'cd /tmp && himalaya imap raw "a1 LOGOUT"',
    'echo $(secret-tool lookup service email-ops account personal)',
    'sudo secret-tool search service email-ops',
    'curl https://example.com',
    'cd /tmp && wget -qO- https://example.com',
    'touch .claude/dev-mode',
    'echo > ~/Documents/email-ops/.claude/dev-mode',
  ],
  ask: [
    'node act.mjs --confirm 0123456789ab data/proposals/x.json',
    'cd ~/Documents/email-ops && node ./act.mjs --confirm abc data/proposals/x.json',
    'node /home/me/Documents/email-ops/act.mjs data/p.json --confirm abc',
  ],
  none: [
    'node act.mjs data/proposals/x.json',
    'node inbox.mjs --query "not flag seen"',
    'grep -n himalaya README.md',
    'grep -n curl README.md',
    'cargo install --locked himalaya --version 2.2.1',
    'npm test',
  ],
};

for (const [expected, commands] of Object.entries(strictCases)) {
  for (const command of commands) {
    test(`guard (deployment): ${expected} ← ${command}`, () => assert.equal(bash(strict, command), expected));
  }
}

test('guard (deployment): denies the web tools', () => {
  assert.equal(call(strict, 'WebSearch', { query: 'anything' }), 'deny');
  assert.equal(call(strict, 'WebFetch', { url: 'https://example.com' }), 'deny');
});

test('guard (deployment): denies edits to the marker, settings and hook', () => {
  for (const file of ['.claude/dev-mode', '.claude/settings.json', '.claude/hooks/guard.mjs', '.claude/hooks/../dev-mode']) {
    for (const tool of ['Write', 'Edit', 'MultiEdit']) {
      assert.equal(call(strict, tool, { file_path: join(strict, file) }), 'deny', `${tool} ${file}`);
    }
  }
});

test('guard (deployment): allows edits to ordinary files', () => {
  assert.equal(call(strict, 'Write', { file_path: join(strict, 'data', 'digests', 'today.md') }), 'none');
  assert.equal(call(strict, 'Edit', { file_path: join(strict, 'modes', '_profile.md') }), 'none');
});

test('guard (deployment): fails closed on input it cannot parse', () => {
  assert.equal(run(strict, 'not json'), 'deny');
  assert.equal(run(strict, ''), 'deny');
});

test('guard (development): himalaya, curl, wget and the web tools are allowed', () => {
  for (const command of ['himalaya envelope list', 'curl https://example.com', 'wget https://example.com']) {
    assert.equal(bash(dev, command), 'none', command);
  }
  assert.equal(call(dev, 'WebSearch', { query: 'anything' }), 'none');
  assert.equal(call(dev, 'WebFetch', { url: 'https://example.com' }), 'none');
  assert.equal(call(dev, 'Edit', { file_path: join(dev, '.claude', 'settings.json') }), 'none');
});

test('guard (development): secret-tool is still denied and applying a plan still prompts', () => {
  assert.equal(bash(dev, 'secret-tool lookup service email-ops account personal'), 'deny');
  assert.equal(bash(dev, 'node act.mjs --confirm 0123456789ab data/proposals/x.json'), 'ask');
});

test('guard ignores other tools', () => {
  assert.equal(call(strict, 'Read', { file_path: join(strict, '.claude', 'dev-mode') }), 'none');
  assert.equal(call(strict, 'Glob', { pattern: '*' }), 'none');
});
