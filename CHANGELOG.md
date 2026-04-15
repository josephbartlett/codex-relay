# Changelog

All notable changes to Codex Relay will be documented in this file.

This project uses Semantic Versioning. Release entries are written when a version is tagged.

## [Unreleased]

No unreleased changes.

## [0.1.2] - 2026-04-15

Patch release for public repository publication discipline after the initial public launch.

### Changed

- Updated public security and release-readiness documentation after the `v0.1.1` release.
- Documented explicit maintainer approval requirements for direct pushes, tags, GitHub releases, and repository-setting changes.

## [0.1.1] - 2026-04-15

Patch release for Slack thread follow-up intent routing found during live wrapper smoke testing.

### Fixed

- Thread replies that ask Relay to create or draft a PR now use the deterministic PR handoff path instead of becoming generic continuation plans.
- Compound replies such as "check the diff, then create a draft PR if there are file changes" now avoid unnecessary Codex planning and return a diff summary when the worktree is clean.

## [0.1.0] - 2026-04-15

Initial official release. Release readiness was verified with the automated full check gate and a live Slack smoke test against a disposable test repository.

### Added

- Slack Socket Mode gateway for mention, shortcut, slash command, action, and App Home flows.
- Two-phase Codex workflow: read-only plan, Slack approval, workspace-write implementation.
- Git worktree isolation for approved write runs.
- JSON and SQLite persistence options.
- Draft PR creation and persisted PR metadata.
- Public roadmap, task tracker, decision log, runbook, security model, and release hygiene docs.
- Secret scanner and full local check command.
- Strict Slack user/channel/repo authorization policy with maintainer role and denied-path tests.
- Public agent/subagent orchestration guide, delegation templates, and agent-ready issue template.
- Structured audit events, `/codex audit`, App Home audit summaries, and local read-only audit viewer.
- Custody-First Orchestration pattern spec, case study, machine-readable YAML work packets, packet checker, maintenance audit, and role-specific packet templates.
- Explicit thread follow-up intent handling for continue, revise plan, run tests, summarize diff, update PR, ready for review, cancel, and unsupported intents.
- Draft PR update lifecycle for follow-up work, including Slack Update PR and PR status controls.
- Ready-for-review PR handoff from Slack for existing draft PRs.
- Compact per-check PR status detail in Slack without CI log ingestion.
- Durable queue jobs, runner leases, heartbeat/retry/recovery behavior, and a local runner daemon entry point.
- Runner hardening checks for Codex profiles, execpolicy rules, and filtered child-process environments.
- Slack-less setup validator, Docker/local service examples, and SQLite backup/restore runbook notes.
- Authenticated remote mode for the read-only audit viewer.
- Conservative cleanup and retention policy for stale session worktrees.
- Bounded ephemeral diff artifact metadata for Slack diff previews.
- Future email control-plane roadmap path for local IMAP/SMTP bridge transports.
- Release readiness gate covering public docs, package metadata, CI posture, ignored runtime paths, and Markdown fence balance.
- Relay-started local session handoff command that queues Slack-bound local Codex work and allows later continuation from the saved Slack thread.
- `/codex handoff` helper that creates a Slack handoff thread and returns the local handoff command skeleton privately.

### Changed

- Project renamed from `codex-slack-harness` to `codex-relay`.
- PR title/body generation now sanitizes Codex markdown summaries and local file links.
- Repo-specific Slack authorization narrows global allowlists in strict mode.
- Work tracking now has a machine-checkable packet layer in addition to human-readable docs.
- Revised follow-up plans and requested test plans now reject stale pending approvals before requesting replacement approval.
- Existing draft PR actions now behave as create/update/no-op lifecycle operations instead of returning stale metadata or creating duplicate PRs.
- Existing draft PRs can be marked ready for review from Slack after origin, branch, and authorization checks.
- Queued task runs now survive persistence reload; interrupted in-process running tasks are still normalized to failed.
- `ExecAdapter` now filters the runner child environment through `CODEX_RUNNER_ENV_ALLOWLIST` instead of inheriting all process variables.
- `npm run check` now includes setup validation before typecheck/build/tests.
- Audit viewer remote binds now require explicit opt-in plus Basic Auth credentials.
- Worktree cleanup now skips active runs, queued jobs, pending approvals, completed sessions without draft PR metadata, and dirty worktrees.
- Diff summaries are bounded, marked ephemeral, and not persisted as patch bodies.
- Updated transitive `follow-redirects` lockfile entry to address npm audit advisory GHSA-r4q5-vmmm-2653.
- Queued completion notifications now render session summaries with continuation guidance and session actions instead of generic progress-only text.

### Security

- `.env`, `.codex-slack`, worktrees, logs, `dist`, and `node_modules` are ignored by git.
- Default runner behavior avoids `danger-full-access`, `--yolo`, and write access before Slack approval.
- Secret scanner checks common Slack, OpenAI, GitHub, private key, and `.env` mistakes before release.
- Slack authorization is enforced before planning, approval execution, cancellation, cleanup, diff summaries, and draft PR creation.
- Audit events avoid raw prompt, Slack thread, command output, and patch-body storage by default.
- Follow-up test execution remains Slack approval-gated because tests can execute repo code and write artifacts.
- Draft PR updates validate existing PR URL and branch metadata before committing or pushing follow-up work.
- Ready-for-review PR actions validate task ownership/maintainer policy, PR URL origin, branch metadata, and open PR state before calling GitHub.
- PR status detail stores and renders only normalized check metadata; audit events remain count-only and do not store raw check payloads or logs.
- Queue audit events store compact job/lease metadata and avoid raw prompts, command output, and diffs.
- Relay-started local handoff runs use the same repo authorization, isolated worktree, queue, runner environment allowlist, and Slack notification boundaries as Slack-originated work.
- Runner child processes no longer inherit Slack, GitHub, OpenAI, cloud-provider, or SSH-agent credentials by default.
- Audit viewer dashboard and event JSON can be protected with Basic Auth; non-loopback binds fail closed without remote opt-in and a password.
