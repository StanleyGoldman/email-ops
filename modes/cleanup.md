# Mode: cleanup

Clear bulk mail (newsletters, promotions, automated notifications) out of an inbox in reviewed batches.

1. Agree on the scope: which account(s), which mailbox (default inbox), and which window, e.g. "older than 30 days" (`--query 'not after 2026-09-29'`) or "everything from the last 3 months" (`--since`). Fetch with a generous `--limit` (500), and narrow on full-page warnings.
2. Group by sender: `fromEmail`, and by domain when one sender family uses several addresses. For each group show the count, the sender, two or three example subjects, the date range, and whether any are unread.
3. Classify the groups:
   - **bulk**: newsletters, promotions, social/app notifications, receipts and alerts older than the window → propose `archive`, or `trash` for pure promotions if the profile says so.
   - **keep**: anything from a person, VIP senders, anything the profile protects, and anything you can't tell → leave it out of the proposal.
   - **ask**: genuinely ambiguous groups. Ask the user rather than guess.
4. Show the grouped table, write the proposal (per `_shared.md`) with one `move` per message, and run the dry run. Large batches are fine: `act.mjs` groups them into a few server calls.
5. After applying, offer to record new always-archive senders in `modes/_profile.md`, which makes future triage faster. Edit the profile only after the user says yes, and show them the lines you added.
