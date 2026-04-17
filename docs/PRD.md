# Product Requirements

This document is the historical seed PRD for the original local MVP. For the current product scope, release status, and build order, use `README.md`, `docs/ROADMAP.md`, and `docs/RELEASE_READINESS.md`.

## Goal

From Slack mobile or desktop, a user can ask Codex to inspect, plan, implement, test, and summarize work in a configured local repository without using Slack as a terminal.

## MVP Scope

- Slack Socket Mode gateway.
- Thread mentions create or continue sessions.
- Configured repo allowlist.
- Git worktree per write-capable session.
- Read-only plan phase.
- Slack approval before implementation.
- Message shortcut task creation.
- `codex exec --json` local runner.
- Local JSON persistence for sessions, runs, and approvals.
- Completion card with summary, branch, changed files, and diff stat.

## Non-Goals

- Full remote shell.
- Inline large diffs.
- Multi-tenant runner isolation.
- Public Slack Marketplace distribution.
- Live mid-turn approvals on `codex exec`.

## Phase 2

- Persistent database.
- App Home dashboard with pending approvals and stale-run recovery.
- Diff summary modal.
- PR creation.
- Resume follow-up mentions against saved Codex exec sessions.

## Phase 3

- Team orchestrator and runner pool.
- Isolated worker containers.
- `SdkAdapter`.
- `AppServerAdapter` for richer streaming and live approvals.
- Installable Codex plugin packaging for shared skills and MCP config.
