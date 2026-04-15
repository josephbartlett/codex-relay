# Proton Mail

Codex Relay supports Proton Mail through generic SMTP settings. Proton-specific values belong only in your local `.env`.

## Outbound Notifications

For outbound-only notifications, use a dedicated Proton SMTP credential when your Proton plan supports direct SMTP sending. Keep that credential separate from your normal account password and rotate it if it is ever exposed.

Use the generic SMTP variables from [SMTP.md](SMTP.md). Fill in the host, port, TLS mode, username, password, sender, and recipient values from Proton's current account, business-app SMTP setup screen, or local Bridge setup.

When using Proton Mail Bridge locally, Bridge may present a local self-signed certificate. In that case, keep the host bound to a trusted local interface and set `EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED=false` for Relay's local process.

When Bridge runs on Windows and Relay development happens in WSL, run the email process from Windows or use a trusted host/port that WSL can reach. Bridge loopback ports may not be reachable from WSL.

## Inbound Commands

For inbound email commands, use [IMAP.md](IMAP.md) with Proton Mail Bridge. Proton documents Bridge as the way to integrate Proton Mail with IMAP and SMTP clients, and notes that Bridge is available for macOS, Windows, and Linux.

Bridge may expose separate local IMAP and SMTP ports. Keep those values in local `.env` only. When Bridge presents a self-signed certificate, keep the host bound to a trusted local interface and set `EMAIL_IMAP_TLS_REJECT_UNAUTHORIZED=false` for the local Relay process.

If Bridge is on Windows and Relay is running in WSL, test reachability before debugging credentials. Some Bridge installs bind to Windows loopback only. In that case, run `npm run email:test` and `npm run email:poll` from Windows, use WSL mirrored networking where available, or configure a trusted local port-forward according to your operating-system policy.

Relay does not need Proton-specific code for the common Bridge path. Treat Bridge as the local SMTP/IMAP endpoint, keep the credentials in local `.env`, and use the generic reply-continuation behavior from [IMAP.md](IMAP.md).

Official references:

- Proton Mail Bridge support: https://proton.me/support/bridge
- Proton IMAP, SMTP, and POP3 setup: https://proton.me/support/imap-smtp-and-pop3-setup

## Safety Notes

- Do not commit Proton account names, bridge ports, token labels, local hostnames, or screenshots.
- Prefer a dedicated credential for Relay.
- Start with outbound notifications, then add read-only IMAP intake.
- Do not enable inbound write approvals until Codex Relay has a nonce-bound approval design.
