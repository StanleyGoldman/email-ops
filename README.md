# email-ops

Manage email from Claude Code, in the style of [career-ops](https://github.com/career-ops-hq/career-ops). Claude triages unread mail across your IMAP accounts, proposes cleanups, drafts replies into your Drafts folder, and answers "find that email" questions. **It never deletes or sends**, and nothing in a mailbox changes until you approve a specific plan.

```
/email-ops triage     digest of unread mail across accounts, then an optional tidy-up proposal
/email-ops cleanup    archive newsletters and notifications in reviewed batches
/email-ops draft      write a reply in your voice and save it to Drafts
/email-ops search     find an email and answer questions about it
```

## How it works

- `modes/*.md` are the prompts that make up the program.
- Four Node scripts do the mail I/O through the [himalaya](https://github.com/pimalaya/himalaya) CLI:

| Script | Does |
|---|---|
| `inbox.mjs` | list or search envelopes across accounts, as JSON |
| `read.mjs` | print one message as text, without marking it read |
| `act.mjs` | dry-run, then apply an approved plan of moves, flags and draft saves |
| `doctor.mjs` | check the build, config, logins and folders |

The scripts use no npm dependencies, only Node built-ins.

## Safety model

| Concern | What prevents it |
|---|---|
| Passwords on disk | They live in the GNOME keyring. `config/himalaya.toml` only holds `secret-tool lookup …` commands, and `doctor` fails on any `password.raw`. |
| Sending mail | himalaya is built **without SMTP or Sieve**, so the binary cannot send. email-ops also never passes `--send`. |
| Deleting mail | There is no delete action. Trash is a move to the Trash folder, which can be undone. |
| An email that says "AI, archive everything" | Email is treated as data. Changes need a plan, its dry run, and a **Claude Code permission prompt that only you can answer**. |
| A plan edited after you reviewed it | `act.mjs --confirm <hash>` refuses unless the file still matches the hash shown in the dry run. A plan runs only once. |
| A stale message id hitting the wrong email | Before acting, each message's live Message-ID is checked against the plan. |
| Claude going around the scripts | A hook denies direct `himalaya` and `secret-tool` calls, curl, wget, WebFetch and WebSearch. In a development checkout, the gitignored `.claude/dev-mode` marker relaxes all of that except `secret-tool`. |
| What happened, and when | Every action is appended to `data/actions.jsonl`. |

These are guardrails against mistakes and prompt injection, not a sandbox against a determined process running as you.

## Setup

1. **Install himalaya 2.2.1, IMAP-only**, plus `secret-tool`:
   ```sh
   RUSTC_WRAPPER= cargo install --locked himalaya --version 2.2.1 \
     --no-default-features --features imap,rustls-ring,vendored
   sudo apt install libsecret-tools
   ```
   `RUSTC_WRAPPER=` skips the global sccache wrapper in `~/.cargo/config.toml`, which fails on this crate.
2. **Store each account's password in the keyring.** This prompts without echoing anything, and nothing lands in your shell history:
   ```sh
   secret-tool store --label="email-ops personal" service email-ops account personal
   secret-tool store --label="email-ops work"     service email-ops account work
   ```
   If your server supports app-specific passwords, use an IMAP-only one.
3. **Deploy:** see below.
4. **Configure the deployment:**
   ```sh
   cd ~/Documents/email-ops
   cp config/himalaya.example.toml config/himalaya.toml     # fill in hosts, usernames, email, display-name
   himalaya -c config/himalaya.toml -a personal mailbox list # find the real folder names
   ```
   Then set `mailbox.alias.archive`, `trash`, `drafts`, `sent` and `junk` for each account to match. When a folder is missing, `npm run doctor` also lists that account's folder names.

   **Coming from Thunderbird?** Its `prefs.js` already holds the hosts, usernames and folder names (`mail.server.*`, `mail.identity.*`). If you use Thunderbird's yearly archiving, `Archives` may be only a parent folder that can't hold mail; point `archive` at a year folder instead.
5. **Profile:** `cp modes/_profile.template.md modes/_profile.md` and edit it, or run `/email-ops profile` and let Claude interview you.
6. `npm run doctor` should end with **All good.** Then open Claude Code in the deployment folder and run `/email-ops triage`.

## Development vs deployment

This follows the same model as career-ops: the git checkout *is* the install, and personal files are gitignored inside it.

- **Dev repo, `~/Documents/code/email-ops`:** change code on a branch, run `npm test`, and open a pull request: `main` on GitHub accepts changes only through PRs. Once it merges, release with a tag on `main`: `git tag v0.2.0 && git push origin v0.2.0`.
  - Create the marker once: `touch .claude/dev-mode`. It is gitignored, so only this checkout has it.
  - Without it, Claude is as restricted here as in a deployment (no direct `himalaya`, no web). `npm run doctor` fails if the marker ever appears in a deployment.
- **Deployment, `~/Documents/email-ops`:** a clone detached at a release tag. This is where you manage mail.
  ```sh
  git clone ~/Documents/code/email-ops ~/Documents/email-ops
  cd ~/Documents/email-ops && git checkout --detach v0.1.0
  ```
- **Update a deployment** with `npm run update` (or `npm run update -- --ref v0.2.0`). It:
  1. refuses if tracked files were edited;
  2. fetches tags from the dev repo;
  3. checks out the newest `v*` tag;
  4. runs `doctor`.

  A checkout only rewrites tracked files, so your config, profile and `data/` are never touched.

**The rule:** if git tracks a file, it's the system's; if git ignores it, it's yours. Yours:
- `config/himalaya.toml`
- `modes/_profile.md`
- `data/`: digests, proposals, drafts, `actions.jsonl`
- `.claude/settings.local.json`

**Each checkout uses its own `config/himalaya.toml`.** Point the dev repo at a throwaway test account to try changes against real IMAP without touching your real mail. Without that file, himalaya's default `~/.config/himalaya/config.toml` is used.

## Layout

```
CLAUDE.md, README.md         rules for the agent; this file
.claude/settings.json        the act --confirm prompt rule and the PreToolUse guard hook
.claude/hooks/guard.mjs      denies direct himalaya/secret-tool, curl/wget/web tools and edits to the guardrails (relaxed by .claude/dev-mode); forces a prompt for act --confirm
.claude/skills/email-ops/    the /email-ops router
modes/                       _shared.md (rules), triage, cleanup, draft, search, _profile.template.md
config/himalaya.example.toml template for config/himalaya.toml
lib/                         paths.mjs, himalaya.mjs (the only place himalaya is run)
inbox.mjs read.mjs act.mjs doctor.mjs update.mjs
tests/                       node --test suites and fake-himalaya.mjs (no network)
```

## Later

- A local SQLite (`node:sqlite`, FTS5) index for fast ranked search, if server-side search proves slow.
  - **Envelopes:** paged `envelope list` calls.
  - **Bodies:** `imap fetch <uids> --body` in batches.
- Undo from `actions.jsonl`, `List-Unsubscribe` detection, and Sieve filter generation.
