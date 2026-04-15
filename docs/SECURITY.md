# Security Model

Codex Relay is a remote control plane for local or self-hosted code execution. Security is a release gate, not a follow-up feature.

## Defaults

- `plan`, `review`, and `explain` run with `read-only`.
- `implement` runs with `workspace-write` only after Slack approval or an explicit Relay local handoff command.
- Direct workspace quick mode is disabled by default and requires explicit repo allowlisting before it can edit a source working tree.
- Email direct workspace mode requires both the global direct workspace gate and the email-specific gate.
- The harness does not use `danger-full-access` or `--yolo`.
- Repositories must be explicitly configured in `CODEX_ALLOWED_REPOS`.
- Writes happen in a git worktree under `CODEX_WORKTREE_ROOT`.
- Relay-started local handoff runs use the same configured repo bindings and session worktree isolation as Slack-originated runs.
- Codex child processes receive only the configured runner environment allowlist, plus `NO_COLOR=1`.

## Slack Authorization

`CODEX_POLICY_MODE=strict` is the default and fails closed.

Strict mode rules:

- Repo-scoped actions require an explicit `CODEX_REPO_ALLOWED_SLACK_USERS` and `CODEX_REPO_ALLOWED_SLACK_CHANNELS` entry for the selected repo.
- If global user/channel allowlists are configured, they act as an outer boundary.
- Repo-specific user/channel allowlists narrow access for that repo.
- Maintainers in `CODEX_MAINTAINER_SLACK_USERS` can operate on another user's task, but they still must use an allowed channel for the repo.
- Slash-command and shortcut modal-open checks only verify that the user/channel is allowed somewhere; the final selected repo is validated before any Codex run starts.

`CODEX_POLICY_MODE=local-dev` permits empty allowlists for isolated development. Use it only on a private machine or disposable workspace.

Authorization is checked before plan start, approval execution, cancellation, cleanup, diff summary, draft PR creation/update, and PR status checks.

## Data Handling

Slack text, prompts, command output, and diffs can contain secrets. Avoid storing full prompt/output logs unless your deployment policy explicitly permits it. The starter implementation writes task state to `CODEX_STATE_PATH` in JSON mode or `CODEX_DATABASE_PATH` in SQLite mode. Store state files on encrypted disks and restrict filesystem permissions in shared environments.

Run secret scanning before commits and releases:

```bash
npm run check:secrets
```

## Audit Data

Codex Relay writes structured audit events to the configured state backend. Audit records are designed to be human-readable without storing raw prompts, full Slack text, command output, patch bodies, or secrets.

Audit events include timestamps, event type, outcome, Slack actor ID when available, repo ID, session/run/approval IDs, and small metadata such as changed-file counts or PR URLs.

Queue audit events record queue job IDs, lease IDs, runner IDs, attempts, and final queue status. They intentionally do not record raw prompts, runner stdout/stderr, patch bodies, or Slack thread contents.

The audit viewer is read-only and binds to `127.0.0.1` by default. The dashboard and `/events.json` can require Basic Auth with `AUDIT_VIEWER_REQUIRE_AUTH=true` and `AUDIT_VIEWER_PASSWORD`.

Remote audit access is fail-closed:

- non-loopback `AUDIT_VIEWER_HOST` values require `AUDIT_VIEWER_ALLOW_REMOTE=true`;
- remote mode requires a non-placeholder `AUDIT_VIEWER_PASSWORD`;
- authentication failure responses do not echo configured passwords or backend state paths;
- `/healthz` is intentionally unauthenticated for process supervision, but it exposes only `ok`.

Do not expose the viewer directly to the public internet. Put remote access behind TLS, firewall rules or a private network, and operator credential rotation. Basic Auth is an operator convenience layer, not a replacement for transport security or network controls.

## Exec Policy

`infra/codex/default.rules` is a starter rules file. Install it under a Codex rules directory and validate it with:

```bash
codex execpolicy check --pretty --rules infra/codex/default.rules -- git remote set-url origin git@example.com:org/repo.git
```

Rules are defense in depth. The primary controls are repo allowlists, worktree isolation, sandbox mode, and explicit approval before writes.

`infra/codex/profiles.toml` defines starter read-only, write, PR, and cleanup runner profiles. Startup checks fail if the configured profiles use `danger-full-access`, enable default network access, or omit required profile names. Runtime Codex invocations pass the selected profile name plus explicit sandbox arguments and inline profile config overrides.

`CODEX_REQUIRE_EXECPOLICY_CHECK=true` is the default. If the installed Codex CLI cannot run `codex execpolicy check`, startup fails rather than assuming the policy file is usable. Set it to `false` only as a temporary compatibility escape hatch; startup will then emit a warning instead.

The default `CODEX_RUNNER_ENV_ALLOWLIST` omits Slack, GitHub, OpenAI, cloud-provider, and SSH-agent credentials. Do not add broad token variables globally. If a repo needs credentials for tests, prefer a repo-specific runner deployment with short-lived credentials.

## Threat Model

Primary threats:

- Unauthorized Slack user starts or approves a write-capable task.
- Slack text tricks the harness into using an unconfigured repo path.
- Codex output leaks secrets into Slack, logs, commits, or PR bodies.
- Duplicate Slack retries create duplicate commits or PRs, update the wrong PR from corrupted local metadata, or publish a draft PR before review.
- PR handoff publishes from a detached, wrong, pre-staged, behind, or locally advanced branch.
- Multiple workers claim the same queued task or continue work after a stale lease.
- Multiple gateway processes deliver the same queued-run Slack notification.
- SMTP credentials are exposed through docs, logs, screenshots, work packets, or committed config.
- Local bridge SMTP TLS verification is disabled for a non-local or untrusted host.
- Multiple email publisher processes deliver the same queued-run email notification.
- IMAP credentials are exposed through docs, logs, screenshots, work packets, or committed config.
- Local bridge IMAP TLS verification is disabled for a non-local or untrusted host.
- Inbound email commands are spoofed, replayed, or parsed too broadly.
- Inbound email ingestion stores raw message bodies, signatures, attachments, or secrets longer than needed.
- Direct workspace mode edits the user's active source working tree when enabled for the wrong repo or dirty tree.
- Email reply continuation is mistaken for authenticated write approval.
- A local handoff command binds remote continuation to the wrong Slack thread, user, repo, or worktree.
- An already-running terminal Codex process is attached without trustworthy session/workspace provenance.
- A worktree cleanup or git command deletes user work.
- Cleanup removes completed work before PR handoff, while a queue/approval is still active, or while a worktree is dirty.
- Diff inspection persists patch bodies or raw command output beyond the Slack modal.
- A runner is configured with overly broad sandbox or network permissions.
- A runner child process inherits Slack, GitHub, OpenAI, cloud, or SSH-agent credentials by default.
- A remote audit viewer exposes repo/session/actor metadata without authentication, TLS, or network controls.

Primary mitigations:

- Resolve repos only from configured bindings.
- Require explicit approval before write runs.
- Restrict mutating actions to the task owner in the current MVP.
- Store PR metadata and make duplicate PR creation/update idempotent when no new user-facing changes exist.
- Validate stored PR URL and branch metadata before committing or pushing PR updates.
- Reject PR handoff from detached HEAD, wrong branches, pre-staged index state, behind-upstream branches, and clean recovery commits that are not present on upstream.
- Validate stored PR URL, origin, branch, and open/draft state before marking a PR ready for review.
- Use SQLite immediate transactions for multi-process queue claims, per-session/repo lease limits, heartbeats, stale-lease rejection, and abandoned-lease recovery.
- Keep queued-run Slack notification payloads compact and sanitized; use SQLite immediate transactions for notification claims before thread delivery.
- Keep queued-run email notification payloads compact and sanitized; use SQLite immediate transactions for notification claims before SMTP delivery.
- Keep SMTP credentials out of runner child-process environment allowlists, docs, tests, screenshots, issues, PRs, and work packets.
- Use `EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED=false` only for trusted local bridge endpoints with self-signed certificates.
- Keep IMAP credentials out of runner child-process environment allowlists, docs, tests, screenshots, issues, PRs, and work packets.
- Use `EMAIL_IMAP_TLS_REJECT_UNAUTHORIZED=false` only for trusted local bridge endpoints with self-signed certificates.
- Scope inbound email to explicit allowlisted senders and mailboxes, durably dedupe message ids, ignore attachments, and store compact message/task metadata instead of raw email source.
- Keep email-originated plan and ask tasks read-only; sender allowlists alone are not sufficient for write approval.
- Keep direct workspace mode disabled by default, repo-scoped, explicit in command text, and clean-tree gated by default.
- Require `EMAIL_DIRECT_WORKSPACE_ENABLED=true` in addition to global direct workspace enablement before email commands can edit a source working tree.
- Treat `relay:<sessionId>` email markers as routing hints, not authentication or approval tokens.
- Support local handoff only when Relay owns the session, worktree, queue job, Slack thread binding, and audit trail before execution starts.
- Defer arbitrary terminal-session attach until a future design can verify Codex session id, workspace path, repo binding, Slack owner, and continuation scope.
- Filter runner child-process environments through an allowlist instead of inheriting `process.env`.
- Validate configured runner profiles and execpolicy guardrails at startup.
- Fail closed for non-loopback audit viewer binds unless remote mode and Basic Auth are configured.
- Use `git worktree remove` without force for cleanup.
- Skip cleanup for active runs, queued jobs, pending approvals, completed sessions without PR metadata, and dirty worktrees.
- Treat diff details as bounded ephemeral artifacts; do not persist patch bodies in durable state.
- Require a separate ADR and security review before enabling email-originated write approvals.
- Keep runtime state, logs, tokens, worktrees, and candidate assets out of git.
- Add policy checks for users, channels, and repos before `v0.1.0`.

## Security Review Checklist

For any PR touching execution, persistence, Slack actions, GitHub, or repo paths:

- Does this change introduce a way to run commands against an unbound repo?
- Does this change allow a non-owner to approve, cancel, inspect, cleanup, create/update a PR, or check PR status?
- Does this change allow a non-owner to mark a draft PR ready for review?
- Can Slack retries or duplicate clicks cause repeated state mutation?
- If PR/CI status detail changes, does it avoid raw CI logs, annotations, artifacts, and full check payload storage?
- If PR handoff changes, can it publish only from the expected session branch and avoid locally advanced or behind-upstream branch state?
- Could logs, Slack cards, PR bodies, or errors expose secrets?
- Are write operations constrained to the session worktree?
- If queue/runner code changes, can duplicate claims, stale leases, and retries be explained from the audit trail?
- If cleanup changes, can active, queued, pending, dirty, and PR-incomplete sessions still avoid deletion?
- If artifact handling changes, are patch bodies bounded and excluded from durable state by default?
- If queued Slack notification delivery changes, can duplicate delivery, failed delivery retries, and sanitized error storage be explained?
- If email notification delivery changes, can duplicate delivery, failed delivery retries, sanitized error storage, and credential handling be explained?
- If inbound email intake changes, can sender allowlists, message dedupe, raw-body retention, attachment handling, and read-only enforcement be explained?
- If email reply continuation changes, is `relay:<sessionId>` still only a routing hint and never a write-approval token?
- If direct workspace mode changes, does it remain disabled by default, repo-scoped, explicit, and covered by dirty-tree tests?
- If local handoff changes, does Relay still own the session/worktree/queue/audit boundary before remote continuation is allowed?
- Are dangerous Codex flags or network permissions introduced?
- Does the runner child-process environment inherit any new credential-bearing variable by default?
- If the audit viewer changes, does localhost remain safe and do remote binds fail closed without credentials?
- Are tests covering allowed and denied paths?
