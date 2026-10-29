#!/usr/bin/env node
// Check that this checkout is ready: himalaya build, config, accounts, folders,
// profile and git state. Exits 1 when anything is broken.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { configPath, himalaya, himalayaVersion, listAccounts, listMailboxes } from './lib/himalaya.mjs';
import { PROFILE, ROOT } from './lib/paths.mjs';

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);
let secretHintShown = false;
const bad = (msg) => {
  failures++;
  console.log(`  ✗ ${msg}`);
  if (/Spawn secret command/.test(msg) && !secretHintShown) {
    secretHintShown = true;
    console.log('      the password lookup failed: is secret-tool installed (sudo apt install libsecret-tools),');
    console.log('      and was the password stored with: secret-tool store ... service email-ops account <name>?');
  }
};

console.log('email-ops doctor\n');

const [major] = process.versions.node.split('.').map(Number);
major >= 22 ? ok(`node ${process.versions.node}`) : bad(`node ${process.versions.node}: need 22 or newer`);

const version = await himalayaVersion();
if (!version) {
  bad('himalaya not found: see README → Setup');
} else if (/\+(smtp|sieve)\b/.test(version)) {
  bad(`${version}: this build can send mail; reinstall the IMAP-only build from the README`);
} else if (!version.startsWith('himalaya v2.2.1')) {
  warn(`${version}: email-ops was checked against v2.2.1`);
} else {
  ok(version);
}

const config = configPath();
const configText = existsSync(config) ? readFileSync(config, 'utf8') : null;
if (configText === null) {
  bad(`no himalaya config at ${config}: copy config/himalaya.example.toml to config/himalaya.toml`);
} else {
  ok(`config ${config}`);
  const live = configText.split('\n').filter((line) => !/^\s*#/.test(line));
  const raw = live.filter((line) => /\.raw\s*=/.test(line));
  raw.length
    ? bad(`config holds ${raw.length} plaintext secret(s) (".raw ="); use password.command with secret-tool`)
    : ok('no plaintext secrets in config');
  if (live.some((line) => /^\s*(smtp|sieve)\./.test(line))) warn('config has smtp/sieve settings; email-ops never sends');
}

if (version && configText !== null) {
  let accounts = [];
  try {
    accounts = await listAccounts();
    accounts.length ? ok(`accounts: ${accounts.map((a) => a.name).join(', ')}`) : bad('config defines no accounts');
  } catch (err) {
    bad(err.message);
  }
  for (const { name, backends } of accounts) {
    const extra = backends.filter((b) => b !== 'imap');
    if (extra.length) bad(`${name}: unexpected backends ${extra.join(', ')}`);
    try {
      const report = await himalaya(['account', 'check'], { account: name });
      for (const b of report.backends) {
        b.ok ? ok(`${name}: ${b.backend} login works`) : bad(`${name}: ${b.backend} login failed: ${b.error}`);
      }
      if (!report.backends.every((b) => b.ok)) continue;
    } catch (err) {
      bad(`${name}: ${err.message}`);
      continue;
    }
    try {
      const roles = new Map((await listMailboxes(name)).filter((m) => m.role).map((m) => [m.role, m.name]));
      for (const role of ['inbox', 'archive', 'trash', 'drafts']) {
        roles.has(role)
          ? ok(`${name}: ${role} → ${roles.get(role)}`)
          : bad(`${name}: no ${role} folder; set mailbox.alias.${role} in the config (himalaya mailbox list shows the names)`);
      }
    } catch (err) {
      bad(`${name}: ${err.message}`);
    }
  }
}

existsSync(PROFILE)
  ? ok('modes/_profile.md')
  : warn('no modes/_profile.md: copy modes/_profile.template.md and fill it in');

try {
  const git = (...args) =>
    execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const where = git('describe', '--tags', '--always', '--dirty');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  ok(branch === 'HEAD' ? `deployment at ${where}` : `dev checkout on ${branch} (${where})`);
  const modified = git('status', '--porcelain', '--untracked-files=no');
  if (modified && branch === 'HEAD') warn(`tracked files edited in a deployment (npm run update will refuse):\n${modified}`);
} catch {
  warn('not a git checkout');
}

console.log(failures ? `\n${failures} problem(s).` : '\nAll good.');
process.exit(failures ? 1 : 0);
