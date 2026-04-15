# IMAP Read-Only Intake

IMAP intake lets Codex Relay poll an allowlisted mailbox and convert plain-text email requests into queued plan, ask/query, or explicitly gated direct workspace tasks.

Relay does not accept implementation approvals, test approvals, PR actions, or other write-capable approvals by email. Direct workspace commands are a separate explicit opt-in for trusted solo repos, not an approval path for isolated worktree plans.

## Configuration

Keep credentials in your local `.env`. Do not commit `.env`, screenshots, bridge ports, account names, token labels, or provider-specific values.

```text
EMAIL_CONTROL_PLANE_ENABLED=true
EMAIL_ALLOWED_SENDERS=operator@example.com
EMAIL_MAILBOX_ID=default
EMAIL_DEFAULT_REPO_ID=default
EMAIL_DIRECT_WORKSPACE_ENABLED=false

EMAIL_IMAP_ENABLED=true
EMAIL_IMAP_HOST=imap.example.com
EMAIL_IMAP_PORT=993
EMAIL_IMAP_SECURE=true
EMAIL_IMAP_TLS_REJECT_UNAUTHORIZED=true
EMAIL_IMAP_USER=relay@example.com
EMAIL_IMAP_PASSWORD=
EMAIL_IMAP_MAILBOX=INBOX
EMAIL_IMAP_POLL_MS=10000
EMAIL_IMAP_MAX_MESSAGES=10
EMAIL_IMAP_MAX_BYTES=200000
EMAIL_IMAP_MARK_SEEN=false
```

Fill `EMAIL_IMAP_PASSWORD` only in your local `.env`.

Use `EMAIL_IMAP_SECURE=true` for implicit TLS IMAP ports such as 993. Use `EMAIL_IMAP_SECURE=false` only for trusted local bridge endpoints.

Keep `EMAIL_IMAP_TLS_REJECT_UNAUTHORIZED=true` for normal providers. Set it to `false` only for trusted local bridge endpoints that use a self-signed certificate.

`EMAIL_IMAP_MARK_SEEN=false` is the conservative default. Relay dedupes processed message ids in its local state store, so marking messages seen is optional.

## Command Shape

Send a plain-text email from an address in `EMAIL_ALLOWED_SENDERS`:

```text
repo:default inspect the failing parser tests and propose a plan
ask repo:default which file produces Table 3?
```

`repo:<id>` is optional when `EMAIL_DEFAULT_REPO_ID` or `CODEX_DEFAULT_REPO_ID` is set.

Accepted plan requests create:

- an email-originated session;
- an isolated worktree;
- a read-only `plan` task run;
- a durable queue job;
- compact audit metadata;
- a compact email acknowledgement when SMTP is configured.

Accepted ask/query requests create a read-only `explain` task run and return a compact answer notification when SMTP is configured.

Rejected requests receive a compact rejection reply when SMTP is configured.

Relay does not reply to non-allowlisted senders. This avoids confirming that a mailbox is monitored or sending automated mail to unrelated unread messages.

## Reply Continuation

Outbound queued, plan-ready, completed, and failed emails include a `relay:<sessionId>` marker. Reply to the email to continue that Relay session:

```text
ask what did you inspect?
continue by proposing the next safest change
```

Replies with `ask` or `query` run read-only and return an answer. Replies without those prefixes queue a read-only plan. Email replies cannot approve an existing plan for execution.

## Direct Workspace Commands

Direct workspace email commands are disabled by default. To allow them:

```text
CODEX_DIRECT_WORKSPACE_ENABLED=true
CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS=default
CODEX_DIRECT_WORKSPACE_REQUIRE_CLEAN=true
EMAIL_DIRECT_WORKSPACE_ENABLED=true
```

Then send an explicit command:

```text
quick repo:default update RELEASE_SMOKE.md with one passing sentence
```

Direct workspace mode edits the configured source repo path, skips PR controls, and should stay limited to trusted solo repositories. It cannot continue an isolated worktree session by email.

## Running

Use the same state backend as the runner:

```bash
npm run dev:email
npm run dev:runner
```

For a one-shot local smoke test, send one plain-text command email from an allowlisted sender, then run:

```bash
npm run email:poll
```

The command prints compact inbound/outbound counts and exits. It does not print credentials or raw email content.

For compiled operation:

```bash
npm run build
npm run start:email
npm run start:runner
```

If SMTP is configured, `npm run dev:email` also publishes queued email notifications. If both SMTP and IMAP are enabled, one email gateway process handles both polling and sending.

## Safety Notes

- Sender allowlists are necessary but not sufficient for write approval. Email write approvals remain disabled.
- Direct workspace mode is not a write approval mechanism; it is an explicit source-working-tree mode with separate global and email gates.
- Relay stores message ids, thread ids, sender, subject, compact status, and task references; it does not store full raw email source.
- Attachments are ignored by the command parser.
- Use SQLite for multi-process runner, gateway, and email polling workflows.
- Do not point Relay at a broad personal inbox. Use an explicit mailbox or folder for Relay commands.
