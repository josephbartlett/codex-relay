# Gmail

Codex Relay supports Gmail through the same generic SMTP and IMAP adapter boundaries used by other providers.

For long-term Gmail support, OAuth is the preferred direction. Google's Gmail documentation describes IMAP, POP, and SMTP support with OAuth 2.0, including SMTP over TLS on port 587 or SSL on port 465.

App passwords may work for some accounts, but Google describes them as a fallback for apps or devices that do not support "Sign in with Google" and requires 2-Step Verification.

Official references:

- Gmail IMAP, POP, and SMTP: https://developers.google.com/workspace/gmail/imap/imap-smtp
- Google Account app passwords: https://support.google.com/accounts/answer/185833

## Outbound Notifications

Use [SMTP.md](SMTP.md) and keep Gmail-specific values in local `.env` only.

Example shape:

```text
EMAIL_SMTP_ENABLED=true
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED=true
EMAIL_SMTP_USER=relay@example.com
EMAIL_SMTP_PASSWORD=
EMAIL_FROM=Codex Relay <relay@example.com>
EMAIL_TO=operator@example.com
```

Fill `EMAIL_SMTP_PASSWORD` only in your local `.env`.

## Inbound Read-Only Intake

Use [IMAP.md](IMAP.md) and keep Gmail-specific values in local `.env` only. Gmail support should remain a provider recipe around the generic IMAP polling boundary, not Gmail-specific core behavior.

Before enabling inbound Gmail commands, define:

- mailbox or label scope;
- duplicate-message handling;
- OAuth or credential lifecycle;
- raw-message retention policy;
- authenticated approval format for a future write-capable design.
