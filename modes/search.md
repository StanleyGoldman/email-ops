# Mode: search

Answer a question about the user's mail, such as "find the invoice from Acme last month" or "what did Sam say about the contract?". **Read-only: no proposals.**

1. Turn the question into one or more DSL queries. Pick the account(s) from the profile when the question implies one, otherwise search all. Examples:
   - "the invoice from Acme last month" → `--query 'from acme and subject invoice' --since 2026-09-01`
   - "anything about the lease" → `--query 'subject lease or body lease'`. Body search runs on the server and can be slow on big folders; try `subject` first.
   - To search outside the inbox, use `--mailbox archive` (or `sent`, or a folder name). One mailbox per call.
2. Run `node inbox.mjs …`. If you get a full-page warning, narrow the query before concluding.
3. Read the most likely matches with `read.mjs` (a few at most), and answer with:
   - what you found: date, sender, subject, and the account and mailbox it lives in;
   - the specific answer, quoted briefly;
   - what you didn't search, if it matters (other folders, older dates).
4. If nothing matches, say which queries you tried, and suggest broader ones or other folders.
