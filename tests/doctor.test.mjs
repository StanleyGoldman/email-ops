import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { defaultState, sandbox } from './helpers.mjs';

// doctor uses config/himalaya.toml when the checkout has one; the dev repo
// doesn't, so HIMALAYA_CONFIG points it at a throwaway file.
function doctor(state) {
  const box = sandbox(state);
  const config = join(box.dir, 'himalaya.toml');
  writeFileSync(config, '[accounts.personal]\nimap.server = "imap.example.com"\n');
  return box.run('doctor.mjs', [], { HIMALAYA_CONFIG: config });
}

test('doctor passes when every account logs in and has its folders', () => {
  const { code, stdout } = doctor();
  assert.equal(code, 0, stdout);
  assert.match(stdout, /personal: archive → Archive/);
  assert.match(stdout, /All good\./);
});

test('a missing folder role fails and lists the folder names to choose from', () => {
  const state = defaultState();
  state.accounts.work.mailboxes = [
    { name: 'INBOX', role: 'inbox' },
    { name: 'INBOX.Archives' },
    { name: 'Trash', role: 'trash' },
    { name: 'Drafts', role: 'drafts' },
  ];
  const { code, stdout } = doctor(state);
  assert.equal(code, 1);
  assert.match(stdout, /✗ work: no archive folder; set mailbox\.alias\.archive/);
  assert.match(stdout, /work folders: "INBOX", "INBOX\.Archives", "Trash", "Drafts"/);
  assert.doesNotMatch(stdout, /personal folders:/);
});

test('a failed password lookup gets the keyring hint, once', () => {
  const state = defaultState();
  state.accounts.personal.checkError = 'Secret command error: ';
  state.accounts.work.checkError = 'Secret command error: ';
  const { code, stdout } = doctor(state);
  assert.equal(code, 1);
  assert.equal(stdout.match(/the password lookup failed/g)?.length, 1);
  assert.doesNotMatch(stdout, /personal: inbox/);
});
