#!/usr/bin/env node
// PreToolUse guard for Claude Code in an email-ops checkout.
//
// - Denies running himalaya or secret-tool directly: mail goes through the
//   scripts, and secrets stay in the keyring.
// - Forces a permission prompt for any `act.mjs ... --confirm`, so only the
//   person at the keyboard can approve a mailbox change. Text inside an email
//   cannot click that prompt.
//
// The permission rules in settings.json only match a command's prefix; this
// catches the same commands behind a path, env assignment, pipe or subshell.
// It is accident prevention, not a sandbox.

import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const command = input.tool_name === 'Bash' ? String(input.tool_input?.command ?? '') : '';

// A word in command position: line start or after ; & | ( ` $( , with optional
// env assignments, wrappers and a path in front.
const commandWord = (name) =>
  new RegExp(String.raw`(^|[;&|(\x60\n]|\$\()\s*(\w+=\S*\s+)*((sudo|env|exec|command|nohup|xargs|time)\s+)*(\S*/)?${name}(\s|$)`);

function decide(permissionDecision, permissionDecisionReason) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } }));
  process.exit(0);
}

if (commandWord('himalaya').test(command)) {
  decide('deny', 'email-ops: use the scripts (inbox.mjs, read.mjs, act.mjs) instead of calling himalaya directly.');
}
if (commandWord('secret-tool').test(command)) {
  decide('deny', 'email-ops: secrets stay in the keyring; the agent never reads them.');
}
if (/act\.mjs\b/.test(command) && /--confirm\b/.test(command)) {
  decide('ask', 'email-ops: this applies a mailbox change plan. Approve only if it matches the dry run you reviewed.');
}
