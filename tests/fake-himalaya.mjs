#!/usr/bin/env node
// A stand-in for the himalaya CLI, enough of it for the scripts' tests.
// Mailbox state lives in the JSON file FAKE_HIMALAYA_STATE; every invocation is
// appended to FAKE_HIMALAYA_LOG so tests can assert what was (not) called.
// FAKE_HIMALAYA_MOVE_FAIL=1 makes `message move` report "No message moved".

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const STATE = process.env.FAKE_HIMALAYA_STATE;
const argv = process.argv.slice(2);
if (process.env.FAKE_HIMALAYA_LOG) appendFileSync(process.env.FAKE_HIMALAYA_LOG, JSON.stringify(argv) + '\n');

if (argv[0] === '--version') {
  console.log('himalaya v2.2.1 +imap +rustls-ring +vendored');
  process.exit(0);
}

const state = JSON.parse(readFileSync(STATE, 'utf8'));
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

let json = false;
let account = null;
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-c') i++;
  else if (argv[i] === '--json') json = true;
  else if (argv[i] === '-a') account = argv[++i];
  else rest.push(argv[i]);
}

function out(data) {
  console.log(json ? JSON.stringify(data) : typeof data === 'string' ? data : data.message ?? JSON.stringify(data));
  process.exit(0);
}
function error(message) {
  console.log(json ? JSON.stringify({ error: message }) : `Error: ${message}`);
  process.exit(1);
}

// Pull `-x value` options out of the remaining words.
function take(words, flags) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '--') {
      positional.push(...words.slice(i + 1));
      break;
    }
    const flag = flags.find((f) => f.names.includes(words[i]));
    if (!flag) positional.push(words[i]);
    else if (flag.bool) opts[flag.key] = true;
    else (opts[flag.key] ??= []).push(words[++i]);
  }
  return { opts, positional };
}

const MAILBOX = { names: ['-m', '--mailbox'], key: 'mailbox' };
const acct = () => state.accounts[account ?? Object.keys(state.accounts)[0]] ?? error(`unknown account ${account}`);
const box = (a, name = 'INBOX') => {
  const m = a.mailboxes.find((mb) => mb.name === name || mb.role === String(name).toLowerCase());
  return m ? m.name : error(`no mailbox ${name}`);
};
const msgs = (a, mailbox) => (a.messages[mailbox] ??= []);
const ianaFlag = (f) => ({ raw: `\\${f[0].toUpperCase()}${f.slice(1)}`, iana: f });
const envelope = (m) => ({
  id: String(m.uid),
  'message-id': m.messageId,
  'in-reply-to': [],
  flags: m.flags.map(ianaFlag),
  subject: m.subject,
  from: [m.from],
  to: [{ name: null, email: 'me@example.com' }],
  date: m.date,
  size: 1000,
});

const [noun, verb, ...words] = rest;
const a = noun === 'account' && verb === 'list' ? null : acct();

switch (`${noun} ${verb}`) {
  case 'account list':
    out({ accounts: Object.keys(state.accounts).map((name, i) => ({ name, default: i === 0, backends: ['imap'] })) });
    break;
  case 'account check':
    out({ account, backends: [{ backend: 'imap', ok: true, error: null }] });
    break;
  case 'mailbox list':
    out({ mailboxes: a.mailboxes.map((m) => ({ id: m.name, name: m.name, role: m.role ?? null })) });
    break;
  case 'envelope list':
  case 'envelope search': {
    const { opts, positional } = take(words, [MAILBOX, { names: ['-s'], key: 'size' }, { names: ['--has-attachment'], key: 'att', bool: true }]);
    const query = positional.join(' ');
    let list = [...msgs(a, box(a, opts.mailbox?.[0]))].sort((x, y) => y.uid - x.uid);
    if (/not flag seen/.test(query)) list = list.filter((m) => !m.flags.includes('seen'));
    out({ queued: 0, envelopes: list.slice(0, Number(opts.size?.[0] ?? 25)).map(envelope) });
    break;
  }
  case 'imap fetch': {
    const { opts, positional } = take(words, [MAILBOX, { names: ['--envelope'], key: 'env', bool: true }]);
    const uids = positional[0].split(',').map(Number);
    const list = msgs(a, box(a, opts.mailbox?.[0] ?? 'INBOX')).filter((m) => uids.includes(m.uid));
    out({ messages: list.map((m, i) => ({ seq: i + 1, uid: m.uid, envelope: { message_id: `<${m.messageId}>`, subject: m.subject } })) });
    break;
  }
  case 'message read': {
    const { opts, positional } = take(words, [MAILBOX]);
    const m = msgs(a, box(a, opts.mailbox?.[0])).find((x) => x.uid === Number(positional[0]));
    if (!m) error(`no message ${positional[0]}`);
    out(`From: ${m.from.name} <${m.from.email}>\nSubject: ${m.subject}\n\n[1] text/plain\n${m.body ?? ''}\n`);
    break;
  }
  case 'flag add':
  case 'flag remove': {
    const { opts, positional } = take(words, [MAILBOX, { names: ['--flag', '-f'], key: 'flag' }]);
    for (const m of msgs(a, box(a, opts.mailbox?.[0]))) {
      if (!positional.includes(String(m.uid))) continue;
      m.flags = verb === 'add' ? [...new Set([...m.flags, ...opts.flag])] : m.flags.filter((f) => !opts.flag.includes(f));
    }
    save();
    out({ flags: opts.flag });
    break;
  }
  case 'message move': {
    const { opts, positional } = take(words, [{ names: ['-f', '--from'], key: 'from' }, { names: ['-t', '--to'], key: 'to' }]);
    const source = msgs(a, box(a, opts.from?.[0]));
    const target = msgs(a, box(a, opts.to[0]));
    const moving = process.env.FAKE_HIMALAYA_MOVE_FAIL ? [] : source.filter((m) => positional.includes(String(m.uid)));
    for (const m of moving) {
      source.splice(source.indexOf(m), 1);
      target.push({ ...m, uid: a.nextUid++ });
    }
    save();
    const n = moving.length;
    out({ message: n === 0 ? 'No message moved: no id matched in the source mailbox' : `${n} message${n > 1 ? 's' : ''} successfully moved` });
    break;
  }
  case 'message reply': {
    const { opts, positional } = take(words, [MAILBOX, { names: ['--body-file'], key: 'body' }, { names: ['--cc'], key: 'cc' }]);
    const m = msgs(a, box(a, opts.mailbox?.[0])).find((x) => x.uid === Number(positional[0]));
    if (!m) error(`no message ${positional[0]}`);
    const body = readFileSync(opts.body[0], 'utf8');
    const cc = opts.cc ? `Cc: ${opts.cc.join(', ')}\r\n` : '';
    out(
      `From: Me <me@example.com>\r\nTo: ${m.from.name} <${m.from.email}>\r\n${cc}Subject: Re: ${m.subject}\r\n` +
        `In-Reply-To: <${m.messageId}>\r\nReferences: <${m.messageId}>\r\n\r\n${body}`,
    );
    break;
  }
  case 'message add': {
    const { opts } = take(words, [MAILBOX, { names: ['--flag', '-f'], key: 'flag' }]);
    const raw = readFileSync(0, 'utf8');
    const uid = a.nextUid++;
    const subject = /^Subject: (.*)$/m.exec(raw)?.[1]?.trim() ?? '';
    msgs(a, box(a, opts.mailbox[0])).push({ uid, messageId: `draft-${uid}@example.com`, from: { name: 'Me', email: 'me@example.com' }, subject, date: null, flags: opts.flag ?? [], raw });
    save();
    out({ id: String(uid), sent: false });
    break;
  }
  default:
    error(`fake himalaya does not implement "${noun} ${verb}"`);
}
