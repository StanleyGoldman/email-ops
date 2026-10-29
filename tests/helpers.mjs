import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { ROOT } from '../lib/paths.mjs';

const message = (uid, subject, from, extra = {}) => ({
  uid,
  messageId: `msg-${uid}@example.com`,
  from: { name: from.split('@')[0], email: from },
  subject,
  date: `2026-10-${String(10 + (uid % 18)).padStart(2, '0')}T09:00:00+00:00`,
  flags: [],
  body: `Body of ${subject}`,
  ...extra,
});

const mailboxes = () => [
  { name: 'INBOX', role: 'inbox' },
  { name: 'Archive', role: 'archive' },
  { name: 'Trash', role: 'trash' },
  { name: 'Drafts', role: 'drafts' },
];

export function defaultState() {
  return {
    accounts: {
      personal: {
        nextUid: 1000,
        mailboxes: mailboxes(),
        messages: {
          INBOX: [
            message(1, 'Weekly newsletter', 'news@letters.example'),
            message(2, 'Can you review the contract?', 'sam@client.example'),
            message(3, 'Lunch Thursday?', 'alex@friends.example', { flags: ['seen'] }),
          ],
        },
      },
      work: {
        nextUid: 2000,
        mailboxes: mailboxes(),
        messages: { INBOX: [message(11, 'Build failed', 'ci@work.example')] },
      },
    },
  };
}

/** A disposable data dir plus fake-himalaya state and call log. */
export function sandbox(state = defaultState()) {
  const dir = mkdtempSync(join(tmpdir(), 'email-ops-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const data = join(dir, 'data');
  mkdirSync(join(data, 'drafts'), { recursive: true });
  const statePath = join(dir, 'state.json');
  const logPath = join(dir, 'calls.jsonl');
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  const env = {
    ...process.env,
    EMAIL_OPS_HIMALAYA_BIN: join(ROOT, 'tests', 'fake-himalaya.mjs'),
    EMAIL_OPS_DATA_DIR: data,
    FAKE_HIMALAYA_STATE: statePath,
    FAKE_HIMALAYA_LOG: logPath,
  };
  return {
    dir,
    data,
    env,
    run(script, args = [], extraEnv = {}) {
      const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
        cwd: ROOT,
        env: { ...env, ...extraEnv },
        encoding: 'utf8',
      });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    state: () => JSON.parse(readFileSync(statePath, 'utf8')),
    calls: () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []),
    writePlan(name, plan) {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify(plan, null, 2));
      return path;
    },
    log: () => {
      const path = join(data, 'actions.jsonl');
      return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse) : [];
    },
  };
}

/** The verb ("message move", "flag add"...) of each logged fake-himalaya call. */
export function verbs(calls) {
  return calls.map((args) => {
    const words = [];
    for (let i = 0; i < args.length && words.length < 2; i++) {
      if (args[i] === '-c' || args[i] === '-a') i++;
      else if (!args[i].startsWith('-')) words.push(args[i]);
    }
    return words.join(' ');
  });
}
