import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../lib/paths.mjs';

function decision(command, tool_name = 'Bash') {
  const r = spawnSync(process.execPath, [join(ROOT, '.claude', 'hooks', 'guard.mjs')], {
    input: JSON.stringify({ tool_name, tool_input: { command } }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'none';
}

const cases = {
  deny: [
    'himalaya envelope list',
    '/home/me/.cargo/bin/himalaya message delete 4',
    'HIMALAYA_CONFIG=x himalaya imap expunge',
    'cd /tmp && himalaya imap raw "a1 LOGOUT"',
    'echo $(secret-tool lookup service email-ops account personal)',
    'sudo secret-tool search service email-ops',
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
    'cargo install --locked himalaya --version 2.2.1',
    'npm test',
  ],
};

for (const [expected, commands] of Object.entries(cases)) {
  for (const command of commands) {
    test(`guard: ${expected} ← ${command}`, () => assert.equal(decision(command), expected));
  }
}

test('guard ignores other tools', () => {
  assert.equal(decision('himalaya envelope list', 'Read'), 'none');
});
