// The only place email-ops runs himalaya. Every call goes through `himalaya()`,
// which refuses any subcommand outside READ_COMMANDS/WRITE_COMMANDS, so the
// scripts cannot delete, expunge, send or speak raw IMAP even by mistake.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_CONFIG } from './paths.mjs';

const READ_COMMANDS = new Set([
  'account list',
  'account check',
  'mailbox list',
  'envelope list',
  'envelope search',
  'message read',
  'imap fetch',
]);

// `message reply` only composes here: without --send or --save it prints the
// raw message to stdout, which act.mjs pipes into `message add`.
const WRITE_COMMANDS = new Set(['message move', 'flag add', 'flag remove', 'message reply', 'message add']);

const FORBIDDEN_ARGS = new Set(['--send', '--save', '--seen']);

export class HimalayaError extends Error {}

export function himalayaBin() {
  return process.env.EMAIL_OPS_HIMALAYA_BIN || 'himalaya';
}

// The checkout's own config/himalaya.toml wins, so the dev repo can point at a
// test account while a deployment uses the real ones.
export function configPath() {
  if (existsSync(LOCAL_CONFIG)) return LOCAL_CONFIG;
  if (process.env.HIMALAYA_CONFIG) return process.env.HIMALAYA_CONFIG;
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'himalaya', 'config.toml');
}

function exec(args, input) {
  const bin = himalayaBin();
  const [cmd, argv] = bin.endsWith('.mjs') ? [process.execPath, [bin, ...args]] : [bin, args];
  return new Promise((resolve, reject) => {
    // stdin is only wired up when there is something to send (`message add`);
    // other commands may exit before reading it.
    const child = spawn(cmd, argv, { stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) =>
      reject(err.code === 'ENOENT' ? new HimalayaError(`himalaya not found (${bin}); see README setup`) : err),
    );
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.on('error', () => {}); // an early exit is reported through the exit code
      child.stdin.end(input);
    }
  });
}

/**
 * Run one himalaya command against one account.
 *
 * @param {string[]} command  e.g. ['envelope', 'list', '-s', '50']
 * @param {object} [opts]
 * @param {string} [opts.account]  account name; omitted for account-agnostic commands
 * @param {boolean} [opts.json=true]  parse stdout as JSON; false returns the raw text
 * @param {string} [opts.input]  bytes for stdin
 */
export async function himalaya(command, { account, json = true, input } = {}) {
  const verb = command.slice(0, 2).join(' ');
  if (!READ_COMMANDS.has(verb) && !WRITE_COMMANDS.has(verb)) {
    throw new HimalayaError(`email-ops does not run "himalaya ${verb}"`);
  }
  const forbidden = command.find((arg) => FORBIDDEN_ARGS.has(arg));
  if (forbidden) throw new HimalayaError(`email-ops never passes ${forbidden} to himalaya`);

  const args = [];
  if (existsSync(LOCAL_CONFIG)) args.push('-c', LOCAL_CONFIG);
  if (json) args.push('--json');
  if (account) args.push('-a', account);
  args.push(...command);

  const { code, stdout, stderr } = await exec(args, input);

  // himalaya reports errors on stdout ({"error": ...} under --json) and exits 1.
  if (code !== 0) {
    let message = stdout.trim() || stderr.trim() || `exit code ${code}`;
    if (json) {
      try {
        message = JSON.parse(stdout).error ?? message;
      } catch {}
    }
    throw new HimalayaError(`himalaya ${verb}${account ? ` (${account})` : ''}: ${message}`);
  }
  if (!json) return stdout;
  try {
    return JSON.parse(stdout);
  } catch {
    throw new HimalayaError(`himalaya ${verb}: expected JSON, got: ${stdout.slice(0, 200)}`);
  }
}

/** e.g. "himalaya v2.2.1 +imap +rustls-ring +vendored", or null when not installed. */
export async function himalayaVersion() {
  try {
    const { code, stdout } = await exec(['--version']);
    return code === 0 ? stdout.split('\n')[0].trim() : null;
  } catch {
    return null;
  }
}

export async function listAccounts() {
  const { accounts } = await himalaya(['account', 'list']);
  return accounts;
}

const mailboxCache = new Map();

export async function listMailboxes(account) {
  if (!mailboxCache.has(account)) {
    mailboxCache.set(account, himalaya(['mailbox', 'list'], { account }).then((r) => r.mailboxes));
  }
  return mailboxCache.get(account);
}

/**
 * The server's own name for a mailbox given as a name, a role (inbox, archive,
 * trash, drafts...) or an alias. `imap fetch` only understands real names, and
 * proposals stay unambiguous when they carry them.
 */
export async function resolveMailbox(account, mailbox = 'inbox') {
  const mailboxes = await listMailboxes(account);
  const wanted = mailbox.toLowerCase();
  const match =
    mailboxes.find((m) => m.name === mailbox) ??
    mailboxes.find((m) => m.role?.toLowerCase() === wanted) ??
    mailboxes.find((m) => m.name.toLowerCase() === wanted);
  return match ? match.name : mailbox;
}

const stripBrackets = (id) => (id ? id.trim().replace(/^<|>$/g, '') : null);

/** Message-IDs of the given UIDs in one mailbox, one IMAP session for the lot. */
export async function fetchMessageIds(account, mailbox, uids) {
  const { messages } = await himalaya(['imap', 'fetch', '-m', mailbox, '--envelope', uids.join(',')], { account });
  return new Map(messages.map((m) => [String(m.uid), stripBrackets(m.envelope?.message_id)]));
}

export function hasFlag(envelope, name) {
  return (envelope.flags ?? []).some(
    (f) => f.iana === name || f.raw?.toLowerCase().replace(/^\\/, '') === name,
  );
}

export function formatAddress(addr) {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}
