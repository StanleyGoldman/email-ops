#!/usr/bin/env node
// List or search envelopes across accounts and print one normalized JSON array.
//
//   node inbox.mjs [--account A] [--mailbox M] [--query DSL] [--since YYYY-MM-DD]
//                  [--limit N] [--attachments]
//
// --query takes himalaya's search DSL: `from x`, `to x`, `subject x`, `body x`,
// `date D`, `after D`, `flag seen|answered|flagged|draft`, joined with and/or/not
// and parentheses. Unread is `not flag seen`; "older than D" is `not after D`.
// Warnings (a full page, a failed account) go to stderr, so stdout stays JSON.

import { parseArgs } from 'node:util';
import { formatAddress, hasFlag, himalaya, listAccounts, resolveMailbox } from './lib/himalaya.mjs';

const { values } = parseArgs({
  options: {
    account: { type: 'string' },
    mailbox: { type: 'string', default: 'inbox' },
    query: { type: 'string' },
    since: { type: 'string' },
    limit: { type: 'string', default: '100' },
    attachments: { type: 'boolean', default: false },
  },
});

const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1) {
  console.error('--limit must be a positive integer');
  process.exit(2);
}

// The DSL's `after` is strictly after, so "since D" means after the day before.
function dayBefore(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--since wants YYYY-MM-DD, got ${date}`);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function buildQuery() {
  const [filter, order] = (values.query ?? '').split(/\border\s+by\b/i).map((s) => s?.trim());
  const clauses = [];
  if (filter) clauses.push(`(${filter})`);
  if (values.since) clauses.push(`after ${dayBefore(values.since)}`);
  if (clauses.length === 0 && !order) return null;
  return `${clauses.join(' and ')} order by ${order || 'date desc'}`.trim();
}

function normalize(account, mailbox, env) {
  const from = env.from ?? [];
  return {
    account,
    mailbox,
    id: env.id,
    messageId: env['message-id'] ?? null,
    from: from.map(formatAddress).join(', '),
    fromEmail: from[0]?.email?.toLowerCase() ?? null,
    to: (env.to ?? []).map(formatAddress).join(', '),
    subject: env.subject ?? '',
    date: env.date ?? null,
    unread: !hasFlag(env, 'seen'),
    flagged: hasFlag(env, 'flagged'),
    answered: hasFlag(env, 'answered'),
    hasAttachment: env['has-attachment'] ?? null,
    size: env.size ?? null,
  };
}

async function main() {
  const query = buildQuery();
  const accounts = values.account ? [values.account] : (await listAccounts()).map((a) => a.name);
  const results = [];
  let failed = 0;

  // One account at a time: each himalaya call is its own TLS session and login.
  for (const account of accounts) {
    try {
      const mailbox = await resolveMailbox(account, values.mailbox);
      const command = query
        ? ['envelope', 'search', '-m', mailbox, '-s', String(limit), ...(values.attachments ? ['--has-attachment'] : []), '--', query]
        : ['envelope', 'list', '-m', mailbox, '-s', String(limit), ...(values.attachments ? ['--has-attachment'] : [])];
      const { envelopes } = await himalaya(command, { account });
      if (envelopes.length >= limit) {
        console.error(
          `warning: ${account}/${mailbox} returned a full page (${limit}); there may be more. ` +
            'Narrow with --since/--query or raise --limit.',
        );
      }
      results.push(...envelopes.map((env) => normalize(account, mailbox, env)));
    } catch (err) {
      failed++;
      console.error(`warning: ${account}: ${err.message}`);
    }
  }

  console.log(JSON.stringify(results, null, 2));
  if (failed === accounts.length) process.exit(1);
}

await main();
