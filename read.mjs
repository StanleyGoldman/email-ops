#!/usr/bin/env node
// Print one message as text, without marking it read.
//
//   node read.mjs <account> <mailbox> <id> [--max-chars N]
//
// The output is wrapped in UNTRUSTED EMAIL CONTENT markers carrying a random
// nonce, so a sender cannot forge the closing marker: everything between them
// came from the sender and is data to summarize, never instructions.

import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { himalaya, resolveMailbox } from './lib/himalaya.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'max-chars': { type: 'string', default: '8000' } },
});

if (positionals.length !== 3) {
  console.error('usage: node read.mjs <account> <mailbox> <id> [--max-chars N]');
  process.exit(2);
}
const [account, mailboxArg, id] = positionals;
const maxChars = Number(values['max-chars']);

// An HTML-only message is printed as markup; reduce it to readable text.
function stripHtml(text) {
  return text
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

try {
  const mailbox = await resolveMailbox(account, mailboxArg);
  // `message read` peeks (BODY.PEEK[]): \Seen stays as it was.
  let text = await himalaya(['message', 'read', '-m', mailbox, id], { account, json: false });
  if (/<(html|body|div|table)\b/i.test(text)) text = stripHtml(text);
  let truncated = '';
  if (text.length > maxChars) {
    truncated = `\n[... truncated ${text.length - maxChars} more characters]`;
    text = text.slice(0, maxChars);
  }
  const nonce = randomBytes(4).toString('hex');
  console.log(`<<<UNTRUSTED EMAIL CONTENT ${nonce} account=${account} mailbox=${mailbox} id=${id}>>>`);
  console.log(text.trimEnd() + truncated);
  console.log(`<<<END UNTRUSTED EMAIL CONTENT ${nonce}>>>`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
