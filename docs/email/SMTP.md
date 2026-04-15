# SMTP Notifications

SMTP notifications let Codex Relay send email summaries when queued runner work reaches a useful lifecycle state.

Relay sends email for:

- accepted, rejected, or failed inbound email commands;
- plan-ready notifications;
- read-only ask/query answers;
- completed implementation/test notifications;
- failed runner notifications.

Relay does not accept email approvals in this release line. Approval by email requires a future nonce-bound or signed approval design.

## Configuration

Keep credentials in your local `.env`. Do not commit `.env`, screenshots, tokens, local hostnames, or account-specific values.

```text
EMAIL_SMTP_ENABLED=true
EMAIL_SMTP_HOST=smtp.example.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED=true
EMAIL_SMTP_USER=relay@example.com
EMAIL_SMTP_PASSWORD=
EMAIL_FROM=Codex Relay <relay@example.com>
EMAIL_TO=operator@example.com
EMAIL_PUBLISHER_POLL_MS=2000
```

Fill `EMAIL_SMTP_PASSWORD` only in your local `.env`.

Use `EMAIL_SMTP_SECURE=true` for implicit TLS ports such as 465. Use `EMAIL_SMTP_SECURE=false` for STARTTLS ports such as 587.

Keep `EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED=true` for normal providers. Set it to `false` only for trusted local bridge endpoints that use a self-signed certificate.

`EMAIL_TO` accepts comma, semicolon, or newline separated recipients.

## Running The Publisher

Use the same state backend as the runner and Slack gateway:

```bash
npm run dev:email
```

For compiled operation:

```bash
npm run build
npm run start:email
```

The email publisher claims pending email notifications from the local store, sends them through SMTP, and records delivery success or failure in the local audit log.

When IMAP intake is enabled, the same email gateway process can also poll inbound mail and enqueue compact acknowledgement, answer, completion, or rejection replies.

Outbound queue, plan-ready, completed, and failed notifications include a `relay:<sessionId>` reference. Replying to one of those messages can continue the same Relay session through IMAP intake. Replies with `ask` or `query` stay read-only; replies without those prefixes queue another read-only plan.

## Local Validation

Run the full local gate before relying on the adapter:

```bash
npm run check
```

To test only SMTP credentials from your local `.env`:

```bash
npm run email:test
```

The smoke email contains no task text, prompt, diff, token, or local path.

For a live local smoke test:

1. Configure SMTP values in `.env`.
2. Run `npm run email:test`.
3. Start the runner and email publisher against the same state backend.
4. Enqueue a local Relay session or complete a Slack-controlled task.
5. Confirm the notification arrives and contains only the compact lifecycle summary and `relay:<sessionId>` reference.

Do not paste SMTP credentials into Slack, issues, PRs, logs, screenshots, or work packets.

## WSL And Local Bridges

If Relay runs in WSL while a local mailbox bridge runs on Windows, the bridge may bind only to Windows `127.0.0.1`. In that setup, run the email publisher or smoke test from the Windows side of the same checkout after building:

```powershell
npm run build
node .\dist\apps\email-gateway\src\testSmtp.js
```

For Proton Mail Bridge and other local bridges with self-signed certificates, set `EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED=false` only in the local environment that runs the email process.
