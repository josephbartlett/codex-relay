# ADR-0003: SQLite Durable Local Store

## Status

Accepted

## Context

JSON persistence made the first local MVP easy to inspect and recover manually, but it is not enough for durable local use or the future team-mode queue. Codex Relay needs restart-safe state for sessions, task runs, approvals, and draft PR metadata.

## Decision

Add `CODEX_STORE_KIND=sqlite` and `CODEX_DATABASE_PATH` as the durable local storage path. Keep JSON as a compatibility fallback. When SQLite mode starts with an empty database, migrate from the configured JSON state file.

Use `better-sqlite3` rather than Node's experimental `node:sqlite` module.

## Consequences

- Local deployments can use a durable database without adding a server dependency.
- The schema can later grow queue and runner lease tables.
- JSON remains useful for development and simple inspection.
- Runtime state still should not be committed.

## Security Impact

SQLite databases can contain Slack task metadata, prompts, summaries, file lists, and PR links. Operators should keep the database under `.codex-slack/`, on encrypted disks when appropriate, and with restricted filesystem permissions.

## Alternatives Considered

- JSON only: too weak for queue and team-mode foundations.
- Postgres immediately: too heavy for solo local mode.
- Node `node:sqlite`: currently experimental on the target Node line.
