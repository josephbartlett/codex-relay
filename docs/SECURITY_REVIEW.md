# Security Review Program

Security review is required for the `v0.1.0` release and for every PR that touches execution, authorization, persistence, GitHub, or Slack actions.

## Release-Blocking Controls

- User allowlist.
- Channel allowlist.
- Repo-specific policy.
- Owner/maintainer authorization checks for mutating actions.
- Secret scanner in local and CI checks.
- Dependency audit in local and CI checks.
- Worktree-only write path.
- Duplicate-action idempotency for approvals and PR creation.
- No dangerous Codex flags as defaults.
- Runner child-process environment allowlist.
- Startup validation for configured Codex profiles and execpolicy rules.

## Review Questions

For each security-sensitive change:

1. Can a Slack user reach a repo they should not reach?
2. Can a Slack user cause write-capable execution without approval?
3. Can Slack retries or duplicate clicks repeat a destructive action?
4. Can Slack text or Codex output control filesystem paths?
5. Can secrets appear in logs, Slack messages, PR bodies, commits, or test snapshots?
6. Does the change weaken sandbox, network, or approval defaults?
7. Does the runner inherit any credential-bearing environment variable by default?
8. Does persistence expose sensitive data unnecessarily?
9. Are failure messages safe to show in Slack?
10. Are deny paths covered by tests?
11. Is the runbook updated for operational risk?

## Manual Review Before v0.1.0

- Review `.env.example` for placeholders only.
- Run `npm run check`.
- Inspect `git status --short --ignored` for ignored local secrets/runtime state.
- Review `infra/codex/default.rules`.
- Review `infra/codex/profiles.toml`.
- Confirm `CODEX_REQUIRE_EXECPOLICY_CHECK=true` unless there is a documented temporary compatibility exception.
- Confirm `CODEX_RUNNER_ENV_ALLOWLIST` does not include broad credential variables.
- Review Slack manifest scopes in `infra/slack/app-manifest.yaml`.
- Confirm GitHub templates require security impact.
- Confirm top-level `SECURITY.md` has private reporting guidance.
