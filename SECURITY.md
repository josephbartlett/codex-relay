# Security Policy

Codex Relay controls local or self-hosted code execution from Slack, local handoff commands, and optional email adapters. Treat it as security-sensitive infrastructure.

## Supported Versions

The supported public release line is `v0.2.x`.

Security fixes land on `main` first, then ship in the next patch release when appropriate.

## Reporting Vulnerabilities

Do not open public issues for vulnerabilities that expose secrets, enable unauthorized code execution, bypass repo/workspace policy, or weaken sandboxing.

Use GitHub private vulnerability reporting for this repository:

- https://github.com/josephbartlett/codex-relay/security/advisories/new

If that channel is unavailable, contact the maintainer through GitHub before sharing exploit details in any public issue, PR, or discussion.

## Security Priorities

The most important security properties are:

- Slack users cannot run Codex against repos they are not authorized to use.
- Write-capable execution happens only after explicit approval.
- Writes are isolated to session worktrees.
- Repo paths are selected from configured bindings, not Slack text.
- Secrets are not logged, posted to Slack, committed, or copied into PR bodies.
- Dangerous Codex execution settings are never defaults.
- Duplicate Slack actions do not create duplicate commits, PRs, or state transitions.
- Email-originated plan and ask commands stay read-only; email direct workspace commands require a separate explicit gate and are not approval replies.
- Direct workspace quick mode is disabled by default, repo-scoped, and intended only for trusted solo source-working-tree edits.

## Default Safe Posture

- `CODEX_POLICY_MODE=strict` fails closed for Slack user, channel, and repo authorization.
- Repo-scoped actions require explicit repo user/channel policy before any Codex run starts.
- Plan/review/explain operations run in `read-only`.
- Implementation runs in `workspace-write` only after Slack approval.
- Direct workspace mode requires `CODEX_DIRECT_WORKSPACE_ENABLED=true`, a repo id in `CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS`, and an explicit `quick` or `direct` request.
- Email direct workspace mode additionally requires `EMAIL_DIRECT_WORKSPACE_ENABLED=true`.
- `danger-full-access` is not a supported default.
- `--yolo` is not allowed in product code.
- Network access should remain disabled unless a repo/task profile explicitly permits it.
- The bot should be invited only to channels where it is intended to operate.

## High-Risk Change Areas

Security review is required for changes touching:

- Slack action authorization.
- Repo binding or path resolution.
- Worktree creation, cleanup, commit, push, or PR creation.
- Runner sandbox, approval policy, environment, or network configuration.
- Email notification or email command handling.
- Persistence schema and migration.
- Logging, telemetry, prompts, diffs, or command output.
- Token handling and Slack/GitHub/Codex authentication.

## Local Secret Scanning

Run:

```bash
npm run check:secrets
```

The scanner is intentionally conservative. If it flags a false positive, adjust the checked fixture or scanner allowlist narrowly; do not weaken the scanner broadly.

## Deployment Notes

- Store `.env`, `.codex-slack/`, SQLite databases, and worktrees on encrypted disks in shared environments.
- Restrict filesystem permissions around repo bindings and state directories.
- Use dedicated Slack apps per environment.
- Rotate Slack/GitHub/OpenAI credentials if they are pasted into Slack, terminal logs, issues, PRs, or committed files.
- Rotate SMTP/app credentials if they are pasted into Slack, terminal logs, issues, PRs, or committed files.
- Rotate IMAP/mailbox credentials if they are pasted into Slack, terminal logs, issues, PRs, or committed files.
- Prefer Socket Mode for solo/local installs because it avoids exposing a public inbound HTTP endpoint.
