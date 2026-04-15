# Security Policy

Codex Relay controls local or self-hosted code execution from Slack. Treat it as security-sensitive infrastructure.

## Supported Versions

No public stable release exists yet. The first supported release target is `v0.1.0`.

Until `v0.1.0` is tagged, security fixes land on `main`.

## Reporting Vulnerabilities

Do not open public issues for vulnerabilities that expose secrets, enable unauthorized code execution, bypass repo/workspace policy, or weaken sandboxing.

Report privately to the maintainer:

- Joey Bartlett
- GitHub: `josephbartlett`

If GitHub private vulnerability reporting is enabled for the repository, use that channel.

## Security Priorities

The most important security properties are:

- Slack users cannot run Codex against repos they are not authorized to use.
- Write-capable execution happens only after explicit approval.
- Writes are isolated to session worktrees.
- Repo paths are selected from configured bindings, not Slack text.
- Secrets are not logged, posted to Slack, committed, or copied into PR bodies.
- Dangerous Codex execution settings are never defaults.
- Duplicate Slack actions do not create duplicate commits, PRs, or state transitions.

## Default Safe Posture

- `CODEX_POLICY_MODE=strict` fails closed for Slack user, channel, and repo authorization.
- Repo-scoped actions require explicit repo user/channel policy before any Codex run starts.
- Plan/review/explain operations run in `read-only`.
- Implementation runs in `workspace-write` only after Slack approval.
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
- Prefer Socket Mode for solo/local installs because it avoids exposing a public inbound HTTP endpoint.
