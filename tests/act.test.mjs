import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { sandbox, verbs } from './helpers.mjs';

const MUTATING = ['message move', 'flag add', 'flag remove', 'message add'];

const archive = (uid, extra = {}) => ({
  action: 'move',
  account: 'personal',
  mailbox: 'INBOX',
  id: String(uid),
  messageId: `msg-${uid}@example.com`,
  from: 'news@letters.example',
  subject: 'Weekly newsletter',
  to: 'archive',
  reason: 'newsletter',
  ...extra,
});

const hashOf = (stdout) => /--confirm ([0-9a-f]{12})/.exec(stdout)?.[1];
const inbox = (s, account = 'personal') => s.state().accounts[account].messages.INBOX.map((m) => m.uid);

test('a dry run shows the plan and its hash and changes nothing', () => {
  const s = sandbox();
  const plan = s.writePlan('plan.json', { mode: 'cleanup', actions: [archive(1)] });
  const r = s.run('act.mjs', [plan]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /move → archive/);
  assert.ok(hashOf(r.stdout));
  assert.ok(!verbs(s.calls()).some((v) => MUTATING.includes(v)));
  assert.deepEqual(inbox(s), [1, 2, 3]);
});

test('the right hash applies the plan and logs it', () => {
  const s = sandbox();
  const plan = s.writePlan('plan.json', { actions: [archive(1)] });
  const hash = hashOf(s.run('act.mjs', [plan]).stdout);
  const r = s.run('act.mjs', ['--confirm', hash, plan]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(inbox(s), [2, 3]);
  assert.equal(s.state().accounts.personal.messages.Archive.length, 1);
  const [action, summary] = s.log();
  assert.equal(action.result, 'ok');
  assert.equal(summary.type, 'plan');
  assert.equal(summary.ok, 1);
});

test('a wrong or stale hash is refused', () => {
  const s = sandbox();
  const plan = s.writePlan('plan.json', { actions: [archive(1)] });
  const hash = hashOf(s.run('act.mjs', [plan]).stdout);
  assert.equal(s.run('act.mjs', ['--confirm', '000000000000', plan]).code, 1);
  // Editing the plan after review changes its hash.
  s.writePlan('plan.json', { actions: [archive(1), archive(2, { messageId: 'msg-2@example.com' })] });
  const r = s.run('act.mjs', ['--confirm', hash, plan]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /hash mismatch/);
  assert.deepEqual(inbox(s), [1, 2, 3]);
});

test('a plan runs once', () => {
  const s = sandbox();
  const plan = s.writePlan('plan.json', { actions: [archive(1)] });
  const hash = hashOf(s.run('act.mjs', [plan]).stdout);
  assert.equal(s.run('act.mjs', ['--confirm', hash, plan]).code, 0);
  const again = s.run('act.mjs', ['--confirm', hash, plan]);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already applied/);
});

for (const action of ['delete', 'expunge', 'send', 'flag-add-deleted']) {
  test(`"${action}" is not an allowed action`, () => {
    const s = sandbox();
    const plan = s.writePlan('plan.json', { actions: [archive(1, { action })] });
    const r = s.run('act.mjs', [plan]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not allowed/);
  });
}

test('only the seen and flagged flags can be changed', () => {
  const s = sandbox();
  const plan = s.writePlan('plan.json', { actions: [archive(1, { action: 'flag-add', flag: 'deleted' })] });
  const r = s.run('act.mjs', [plan]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /flag must be one of/);
});

test('a UID that now holds a different message is skipped', () => {
  const s = sandbox();
  const plan = s.writePlan('plan.json', { actions: [archive(1, { messageId: 'someone-else@example.com' })] });
  const hash = hashOf(s.run('act.mjs', [plan]).stdout);
  const r = s.run('act.mjs', ['--confirm', hash, plan]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /0 ok, 1 skipped/);
  assert.match(s.log()[0].detail, /Message-ID mismatch/);
  assert.deepEqual(inbox(s), [1, 2, 3]);
});

test('"No message moved" is a failure, not a success', () => {
  const s = sandbox();
  const plan = s.writePlan('plan.json', { actions: [archive(1)] });
  const hash = hashOf(s.run('act.mjs', [plan]).stdout);
  const r = s.run('act.mjs', ['--confirm', hash, plan], { FAKE_HIMALAYA_MOVE_FAIL: '1' });
  assert.equal(r.code, 1);
  assert.equal(s.log()[0].result, 'failed');
});

test('flags are applied before moves, while the UID is still valid', () => {
  const s = sandbox();
  const plan = s.writePlan('plan.json', {
    actions: [archive(2, { messageId: 'msg-2@example.com' }), archive(2, { action: 'flag-add', flag: 'flagged', messageId: 'msg-2@example.com' })],
  });
  const hash = hashOf(s.run('act.mjs', [plan]).stdout);
  assert.equal(s.run('act.mjs', ['--confirm', hash, plan]).code, 0);
  const moved = s.state().accounts.personal.messages.Archive[0];
  assert.deepEqual(moved.flags, ['flagged']);
});

test('save-draft composes a threaded reply into Drafts without sending', () => {
  const s = sandbox();
  const body = join(s.data, 'drafts', 'reply.txt');
  writeFileSync(body, 'Happy to review it this week.\n');
  const plan = s.writePlan('plan.json', {
    actions: [{ action: 'save-draft', account: 'personal', mailbox: 'INBOX', id: '2', messageId: 'msg-2@example.com', bodyFile: body, cc: ['pat@client.example'] }],
  });
  const dry = s.run('act.mjs', [plan]);
  assert.match(dry.stdout, /draft To: sam <sam@client.example>\s+Cc: pat@client.example/);
  const r = s.run('act.mjs', ['--confirm', hashOf(dry.stdout), plan]);
  assert.equal(r.code, 0, r.stderr);
  const [draft] = s.state().accounts.personal.messages.Drafts;
  assert.deepEqual(draft.flags, ['draft']);
  assert.match(draft.raw, /In-Reply-To: <msg-2@example.com>/);
  assert.ok(!s.calls().flat().some((arg) => arg === '--send' || arg === '--save'));
});

test('a draft body must live in data/drafts', () => {
  const s = sandbox();
  const outside = join(s.dir, 'elsewhere.txt');
  writeFileSync(outside, 'hi');
  const plan = s.writePlan('plan.json', {
    actions: [{ action: 'save-draft', account: 'personal', mailbox: 'INBOX', id: '2', messageId: 'msg-2@example.com', bodyFile: outside }],
  });
  const r = s.run('act.mjs', [plan]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /must live in/);
});
