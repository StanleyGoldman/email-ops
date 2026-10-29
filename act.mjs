#!/usr/bin/env node
// The one way email-ops changes a mailbox: execute an approved proposal.
//
//   node act.mjs <plan.json>                    dry run: validate, show, print the hash
//   node act.mjs --confirm <hash> <plan.json>   execute, only if the file still has that hash
//
// Allowed actions: move (archive and trash are moves), flag-add, flag-remove
// (seen, flagged), save-draft. There is no delete, expunge or send, and
// lib/himalaya.mjs would refuse them anyway. Before touching a message, its
// live Message-ID is checked against the one in the plan, so a stale UID never
// hits the wrong email. Every outcome is appended to data/actions.jsonl.
//
// Plan file:
//   { "mode": "triage", "summary": "...", "actions": [
//     { "action": "move", "account": "personal", "mailbox": "INBOX", "id": "4211",
//       "messageId": "abc@example.com", "from": "...", "subject": "...",
//       "to": "archive", "reason": "newsletter" },
//     { "action": "flag-add", ..., "flag": "flagged" },
//     { "action": "save-draft", ..., "bodyFile": "data/drafts/reply-to-sam.txt", "cc": [] } ] }

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fetchMessageIds, himalaya, resolveMailbox } from './lib/himalaya.mjs';
import { ACTIONS_LOG, DRAFTS, ROOT } from './lib/paths.mjs';

const ACTIONS = new Set(['move', 'flag-add', 'flag-remove', 'save-draft']);
const FLAGS = new Set(['seen', 'flagged']);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { confirm: { type: 'string' } },
});

if (positionals.length !== 1) {
  console.error('usage: node act.mjs <plan.json>  |  node act.mjs --confirm <hash> <plan.json>');
  process.exit(2);
}

const planPath = resolve(positionals[0]);
const planBytes = readFileSync(planPath);
const hash = createHash('sha256').update(planBytes).digest('hex').slice(0, 12);

function fail(message) {
  console.error(`act: ${message}`);
  process.exit(1);
}

function resolveBodyFile(file) {
  const path = resolve(ROOT, file);
  if (!existsSync(path)) throw new Error(`bodyFile not found: ${file}`);
  const real = realpathSync(path);
  const drafts = existsSync(DRAFTS) ? realpathSync(DRAFTS) : DRAFTS;
  if (relative(drafts, real).startsWith('..')) throw new Error(`bodyFile must live in ${DRAFTS}: ${file}`);
  return real;
}

function validate(plan) {
  if (!Array.isArray(plan?.actions) || plan.actions.length === 0) throw new Error('plan has no actions');
  const seen = new Set();
  plan.actions.forEach((a, i) => {
    const where = `action ${i + 1}`;
    if (!ACTIONS.has(a.action)) throw new Error(`${where}: "${a.action}" is not allowed (only ${[...ACTIONS].join(', ')})`);
    for (const key of ['account', 'mailbox', 'id']) {
      if (typeof a[key] !== 'string' || !a[key]) throw new Error(`${where}: missing ${key}`);
    }
    if (!/^\d+$/.test(a.id)) throw new Error(`${where}: id must be an IMAP UID, got ${a.id}`);
    if (!('messageId' in a)) throw new Error(`${where}: missing messageId (use null if the message has none)`);
    if (a.action === 'move') {
      if (typeof a.to !== 'string' || !a.to) throw new Error(`${where}: move needs "to"`);
      const key = `${a.account}\0${a.mailbox}\0${a.id}`;
      if (seen.has(key)) throw new Error(`${where}: message ${a.id} is moved twice`);
      seen.add(key);
    }
    if (a.action.startsWith('flag-') && !FLAGS.has(a.flag)) {
      throw new Error(`${where}: flag must be one of ${[...FLAGS].join(', ')}`);
    }
    if (a.action === 'save-draft') {
      a.bodyPath = resolveBodyFile(a.bodyFile ?? '');
      if (a.cc && !Array.isArray(a.cc)) throw new Error(`${where}: cc must be a list`);
    }
  });
}

function alreadyExecuted() {
  if (!existsSync(ACTIONS_LOG)) return false;
  return readFileSync(ACTIONS_LOG, 'utf8')
    .split('\n')
    .some((line) => line.includes(`"planHash":"${hash}"`) && line.includes('"type":"plan"'));
}

function log(record) {
  mkdirSync(dirname(ACTIONS_LOG), { recursive: true });
  appendFileSync(ACTIONS_LOG, JSON.stringify({ ts: new Date().toISOString(), planHash: hash, ...record }) + '\n');
}

// --- composed drafts -------------------------------------------------------

function decodeWord(value) {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, charset, enc, text) => {
    const bytes =
      enc.toLowerCase() === 'b'
        ? Buffer.from(text, 'base64')
        : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary');
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return bytes.toString();
    }
  });
}

function headers(raw) {
  const head = raw.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, ' ');
  const out = {};
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).toLowerCase()] = decodeWord(line.slice(i + 1).trim());
  }
  return out;
}

async function composeDraft(a) {
  const cc = (a.cc ?? []).flatMap((addr) => ['--cc', addr]);
  return himalaya(['message', 'reply', '-m', a.mailbox, '--body-file', a.bodyPath, ...cc, a.id], {
    account: a.account,
    json: false,
  });
}

// --- dry run ---------------------------------------------------------------

function short(text, n) {
  text = String(text ?? '');
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}

async function dryRun(plan) {
  console.log(`Plan ${relative(process.cwd(), planPath)}${plan.mode ? ` (${plan.mode})` : ''}`);
  if (plan.summary) console.log(plan.summary);
  console.log('');
  for (const [i, a] of plan.actions.entries()) {
    const what =
      a.action === 'move' ? `move → ${a.to}` : a.action === 'save-draft' ? 'save draft reply' : `${a.action} ${a.flag}`;
    console.log(`${String(i + 1).padStart(3)}. ${what.padEnd(22)} ${a.account}/${a.mailbox} #${a.id}`);
    console.log(`     ${short(a.from, 40)} — ${short(a.subject, 60)}`);
    if (a.reason) console.log(`     why: ${short(a.reason, 90)}`);
    if (a.action === 'save-draft') {
      try {
        const h = headers(await composeDraft(a));
        console.log(`     draft To: ${h.to ?? '(none)'}${h.cc ? `  Cc: ${h.cc}` : ''}`);
        console.log(`     draft Subject: ${h.subject ?? ''}   From: ${h.from ?? '(none: set email in config)'}`);
      } catch (err) {
        console.log(`     draft could not be composed: ${err.message}`);
      }
    }
  }
  const counts = plan.actions.reduce((c, a) => ((c[a.action] = (c[a.action] ?? 0) + 1), c), {});
  console.log('');
  console.log(Object.entries(counts).map(([k, n]) => `${n} × ${k}`).join(', '));
  console.log(`\nNothing has changed. To apply exactly this plan:\n  node act.mjs --confirm ${hash} ${relative(ROOT, planPath)}`);
}

// --- execution -------------------------------------------------------------

function group(actions, keyOf) {
  const groups = new Map();
  for (const a of actions) {
    const key = keyOf(a);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  return [...groups.values()];
}

function record(a, result, detail, extra = {}) {
  const { account, mailbox, id, messageId, action, to, flag, from, subject } = a;
  log({ type: 'action', account, mailbox, id, messageId, action, to, flag, from, subject, result, detail, ...extra });
  return result;
}

// Drop actions whose UID no longer holds the message the plan was written for.
async function verify(actions, tally) {
  const ok = [];
  for (const batch of group(actions, (a) => `${a.account}\0${a.mailbox}`)) {
    const { account, mailbox } = batch[0];
    let live;
    try {
      live = await fetchMessageIds(account, mailbox, [...new Set(batch.map((a) => a.id))]);
    } catch (err) {
      batch.forEach((a) => tally(record(a, 'failed', `could not verify: ${err.message}`)));
      continue;
    }
    for (const a of batch) {
      if (!live.has(a.id)) tally(record(a, 'skipped', 'no message with this UID any more (moved or deleted?)'));
      else if (a.messageId !== null && live.get(a.id) !== a.messageId.replace(/^<|>$/g, ''))
        tally(record(a, 'skipped', `Message-ID mismatch: plan ${a.messageId}, server ${live.get(a.id)}`));
      else ok.push(a);
    }
  }
  return ok;
}

async function execute(plan) {
  const results = { ok: 0, skipped: 0, failed: 0 };
  const tally = (r) => results[r]++;
  // `imap fetch` needs the server's own folder name, not a role like "inbox".
  for (const a of plan.actions) a.mailbox = await resolveMailbox(a.account, a.mailbox);
  const verified = await verify(plan.actions, tally);

  // Flags and drafts first: a move changes the message's UID.
  for (const batch of group(verified.filter((a) => a.action.startsWith('flag-')), (a) => `${a.account}\0${a.mailbox}\0${a.action}\0${a.flag}`)) {
    const { account, mailbox, action, flag } = batch[0];
    const verb = action === 'flag-add' ? 'add' : 'remove';
    try {
      await himalaya(['flag', verb, '-m', mailbox, '--flag', flag, ...batch.map((a) => a.id)], { account });
      batch.forEach((a) => tally(record(a, 'ok', `${verb} ${flag}`)));
    } catch (err) {
      batch.forEach((a) => tally(record(a, 'failed', err.message)));
    }
  }

  for (const a of verified.filter((a) => a.action === 'save-draft')) {
    try {
      const raw = await composeDraft(a);
      const drafts = await resolveMailbox(a.account, 'drafts');
      const out = await himalaya(['message', 'add', '-m', drafts, '--flag', 'draft'], { account: a.account, input: raw });
      if (out.sent) throw new Error('himalaya reported the draft as sent; stop and investigate');
      const h = headers(raw);
      tally(record(a, 'ok', `draft saved to ${drafts}`, { draftId: out.id, draftTo: h.to, draftSubject: h.subject }));
    } catch (err) {
      tally(record(a, 'failed', err.message));
    }
  }

  for (const batch of group(verified.filter((a) => a.action === 'move'), (a) => `${a.account}\0${a.mailbox}\0${a.to}`)) {
    const { account, mailbox, to } = batch[0];
    const ids = batch.map((a) => a.id);
    try {
      const target = await resolveMailbox(account, to);
      const { message } = await himalaya(['message', 'move', '-f', mailbox, '-t', target, ...ids], { account });
      // "No message moved: ..." still exits 0, so read the count.
      const moved = /^(\d+) messages? successfully moved/.exec(message ?? '')?.[1];
      if (Number(moved) === ids.length) {
        batch.forEach((a) => tally(record(a, 'ok', `moved to ${target}`)));
        continue;
      }
      // Partial: whatever is still in the source mailbox did not move.
      const left = await fetchMessageIds(account, mailbox, ids);
      batch.forEach((a) =>
        tally(left.has(a.id) ? record(a, 'failed', `not moved: ${message}`) : record(a, 'ok', `moved to ${target}`)),
      );
    } catch (err) {
      batch.forEach((a) => tally(record(a, 'failed', err.message)));
    }
  }

  log({ type: 'plan', planFile: relative(ROOT, planPath), mode: plan.mode ?? null, ...results });
  console.log(`Applied ${relative(process.cwd(), planPath)}: ${results.ok} ok, ${results.skipped} skipped, ${results.failed} failed.`);
  if (results.skipped || results.failed) console.log(`Details: ${relative(process.cwd(), ACTIONS_LOG)} (planHash ${hash})`);
  if (results.failed) process.exit(1);
}

let plan;
try {
  plan = JSON.parse(planBytes.toString('utf8'));
  validate(plan);
} catch (err) {
  fail(err.message);
}

if (values.confirm === undefined) {
  await dryRun(plan);
} else if (values.confirm !== hash) {
  fail(`hash mismatch: the plan is ${hash}, you confirmed ${values.confirm}. Re-run the dry run and review it again.`);
} else if (alreadyExecuted()) {
  fail(`plan ${hash} was already applied (see ${ACTIONS_LOG}). Make a new proposal instead.`);
} else {
  await execute(plan);
}
