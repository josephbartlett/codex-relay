# ADR-0005: Email Read-Only Control Plane

## Status

Accepted

## Context

Codex Relay needs a local-first remote control option for operators who cannot or do not want to expose an HTTP endpoint. Slack Socket Mode covers Slack. Email can cover a different environment: a local IMAP/SMTP bridge, an explicit mailbox, and mobile access through any mail client.

Email sender identity is weaker than Slack app identity. Plain email is also easy to forward, replay, quote, and spoof depending on provider and deployment. That makes email useful for read-only planning and notifications, but not sufficient for write approval by itself.

## Decision

Add email as an optional adapter with two boundaries:

1. SMTP outbound notifications for accepted commands, plan-ready summaries, completed runs, and failures.
2. IMAP inbound polling for allowlisted plain-text commands that enqueue read-only plan tasks only.

Email-originated sessions reuse the same durable queue, runner daemon, worktree isolation, audit events, and notification model as the rest of Relay. They do not create Slack notifications because they are not bound to real Slack channels. They may send compact email replies when SMTP is configured.

Inbound email records store message ids, thread ids, sender, subject, compact status, and task references. They do not store full raw email source or attachments.

Email-originated write approvals remain out of scope until a future design adds nonce-bound or signed approval replies with expiry and audit records.

## Consequences

- Operators can start read-only Codex planning from email without Slack credentials.
- Proton Mail Bridge and similar local bridge setups can be used without exposing a public inbound endpoint.
- The runner trust boundary stays unchanged.
- Duplicate polling is controlled by durable inbound message records.
- Email replies are useful for status but cannot approve write work.

## Security Impact

- IMAP and SMTP credentials must stay in local `.env` only.
- Sender allowlists are fail-closed but are not treated as write-approval authentication.
- Local bridge TLS verification can be disabled only for trusted local bridge endpoints.
- Raw email source, attachments, quoted history, and signatures are not retained by default.

## Alternatives Considered

- Email notifications only: safe but incomplete for mobile read-only task dispatch.
- Write approvals by email immediately: rejected because plain sender matching is too weak.
- Provider-specific Proton or Gmail core code: rejected in favor of a generic IMAP/SMTP adapter boundary with provider recipes.
