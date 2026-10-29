# Mode: draft

Draft a reply in the user's voice and save it to their Drafts folder. **email-ops never sends**: the user reviews and sends it from their own mail client.

1. Identify the message. If the user describes it ("Sam's contract email"), find it with `inbox.mjs`, confirm which one if there are several, and note its `account`, `mailbox`, `id`, `messageId`, `from` and `subject`.
2. Read it with `read.mjs`. If the reply depends on earlier messages in the thread, search for them by subject (`--query 'subject "<subject>"'`) in the inbox and in `sent`.
3. Ask for anything you can't know: the decision, dates, numbers, attachments the user means to add later. **Never invent commitments, facts or availability.** If the user gives you the gist, write from that.
4. Write the body to `data/drafts/<YYYY-MM-DD>-<slug>.txt`:
   - plain text, only what the user writes: no headers, no quoted original (Himalaya quotes it), and no signature unless the profile says the config doesn't add one;
   - in the profile's voice: greeting style, length, sign-off;
   - in the language of the original email unless the user says otherwise.
5. Show the user the text and let them edit it until it's right.
6. Write a proposal with one `save-draft` action per draft (`bodyFile` is the path above, plus optional `cc` addresses the user asked for). The dry run shows the composed To, Cc, Subject and From. Point out anything surprising, e.g. a Reply-To that routes the reply somewhere unexpected. Then follow the proposal flow in `_shared.md`.
7. Tell the user the draft is in the Drafts folder of that account, ready to review and send from their mail client.
