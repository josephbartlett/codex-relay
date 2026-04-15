# Email Control Plane

Codex Relay treats email as an optional local-first control-plane adapter. Slack remains the primary control plane; email support is additive and disabled by default.

Current email support:

- SMTP outbound notifications for plan-ready, completed, and failed runner events.
- IMAP intake for allowlisted plain-text plan and ask/query commands.
- Reply-to-email continuation through a `relay:<sessionId>` reference included in outbound summaries.
- Direct workspace email commands only when both the global direct workspace gate and email-specific gate are enabled.
- Durable inbound message dedupe across JSON and SQLite stores.

Not implemented yet:

- Email-originated write approvals.
- Provider-specific core behavior.

## Recommended Order

1. Configure SMTP outbound notifications.
2. Verify delivery with a dedicated provider credential.
3. Configure IMAP command intake against an explicit mailbox or folder.
4. Optionally enable direct workspace email commands only for trusted solo repos after reviewing the security docs.
5. Add authenticated approval replies only after a future nonce-bound or signed approval design.

## Command Shape

Use plain-text commands from an allowlisted sender:

```text
repo:api inspect the failing parser tests and propose a plan
ask repo:api which file produces Table 3?
query repo:api what changed in the latest run?
```

Outbound summaries include a `relay:<sessionId>` marker. Reply to the summary email to continue the same Relay session:

```text
ask which files did you inspect?
continue by checking the current diff and proposing the next step
```

Email replies with `ask` or `query` stay read-only and return an answer. Replies without those prefixes queue a read-only plan. Email replies do not approve implementation.

Direct workspace email commands use `quick` or `direct`, and require both `CODEX_DIRECT_WORKSPACE_ENABLED=true` and `EMAIL_DIRECT_WORKSPACE_ENABLED=true`.

## Provider Recipes

- [Generic SMTP](SMTP.md)
- [Generic IMAP](IMAP.md)
- [Proton Mail](PROTON.md)
- [Gmail](GMAIL.md)

Provider recipes are examples. Contributors can add additional provider notes when they preserve the same adapter contract, security model, and no-secrets documentation standard.
