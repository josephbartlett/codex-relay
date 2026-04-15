# ADR 0001: Two-Phase Exec Adapter

## Status

Accepted.

## Context

`codex exec` is the fastest stable automation surface for a local Slack harness, but it is built for non-interactive runs. Slack approvals are also better as explicit state transitions than as terminal-like prompts.

## Decision

The MVP uses two runs:

1. Read-only plan run.
2. Approved workspace-write implementation run.

The orchestrator owns approval state and passes the approved plan into the implementation prompt.

## Consequences

- The first product slice is simple and auditable.
- Slack users see one clear approval decision before writes.
- Live mid-turn approval is deferred to `AppServerAdapter`.
