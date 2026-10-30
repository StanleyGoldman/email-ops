#!/usr/bin/env node
// PreToolUse guard for Claude Code in an email-ops checkout.
//
// Always:
// - Denies running secret-tool: secrets stay in the keyring.
// - Forces a permission prompt for any `act.mjs ... --confirm`, so only the
//   person at the keyboard can approve a mailbox change. Text inside an email
//   cannot click that prompt.
//
// Unless this checkout is marked as development (a gitignored .claude/dev-mode
// file, which no deployment has):
// - Denies running himalaya directly: mail goes through the scripts.
// - Denies curl, wget, WebFetch and WebSearch: the agent reads private mail and
//   untrusted content, so outbound network access stays closed.
// - Denies edits to the marker, settings.json and this hook.
//
// It fails closed: input it cannot parse is denied. This is accident and
// prompt-injection prevention, not a sandbox.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLAUDE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const DEV_MODE = existsSync(join(CLAUDE_DIR, 'dev-mode'));

// A word in command position: line start or after ; & | ( ` $( , with optional
// env assignments, wrappers and a path in front.
const commandWord = (name) =>
  new RegExp(String.raw`(^|[;&|(\x60\n]|\$\()\s*(\w+=\S*\s+)*((sudo|env|exec|command|nohup|xargs|time)\s+)*(\S*/)?${name}(\s|$)`);

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const PROTECTED = [join(CLAUDE_DIR, 'dev-mode'), join(CLAUDE_DIR, 'settings.json'), join(CLAUDE_DIR, 'hooks')];

function decide(permissionDecision, permissionDecisionReason) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } }));
  process.exit(0);
}

function guard(input) {
  const tool = input.tool_name;
  const command = tool === 'Bash' ? String(input.tool_input?.command ?? '') : '';

  if (commandWord('secret-tool').test(command)) {
    decide('deny', 'email-ops: secrets stay in the keyring; the agent never reads them.');
  }

  if (!DEV_MODE) {
    const strict = 'email-ops: not allowed in a deployment (a development checkout has .claude/dev-mode).';
    if (commandWord('himalaya').test(command)) {
      decide('deny', 'email-ops: use the scripts (inbox.mjs, read.mjs, act.mjs) instead of calling himalaya directly.');
    }
    if (commandWord('(curl|wget)').test(command)) decide('deny', `${strict} No outbound network from the shell.`);
    if (tool === 'WebFetch' || tool === 'WebSearch') decide('deny', `${strict} No web access while mail is in reach.`);
    if (/dev-mode/.test(command)) decide('deny', `${strict} The dev-mode marker is not the agent's to touch.`);
    if (WRITE_TOOLS.has(tool)) {
      const target = resolve(String(input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? ''));
      if (PROTECTED.some((p) => target === p || target.startsWith(p + '/'))) {
        decide('deny', `${strict} The guardrails are not the agent's to edit.`);
      }
    }
  }

  if (/act\.mjs\b/.test(command) && /--confirm\b/.test(command)) {
    decide('ask', 'email-ops: this applies a mailbox change plan. Approve only if it matches the dry run you reviewed.');
  }
}

try {
  guard(JSON.parse(readFileSync(0, 'utf8')));
} catch (err) {
  decide('deny', `email-ops guard could not read the tool call (${err.message}); denying to be safe.`);
}
