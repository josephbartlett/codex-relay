# Task And Roadmap Management

This repository uses lightweight public planning files rather than an external-only task system.

## Sources Of Truth

- `docs/ROADMAP.md`: release-level scope and acceptance criteria.
- `docs/TASKS.md`: active, next, done, and deferred work.
- `docs/work-packets/*.yaml`: machine-readable custody packets.
- `docs/MAINTENANCE_AUDIT.md`: human-readable rollup of packet and commit evidence.
- GitHub issues: public discussion and task breakdown once the repository is public.
- Pull requests: implementation records linked to roadmap/task items.
- `docs/DECISIONS.md` and `docs/ADRs/`: decisions that explain why work took a particular shape.

## Tracked And Untracked Orchestration State

Track the governance and audit layer. Ignore the runtime and scratch layer.

Tracked orchestration artifacts include:

- `AGENTS.md`
- `docs/AGENT_ORCHESTRATION.md`
- `docs/CUSTODY_FIRST_ORCHESTRATION.md`
- `docs/TASK_MANAGEMENT.md`
- `docs/TASKS.md`
- `docs/DECISIONS.md` and `docs/ADRs/`
- `docs/MAINTENANCE_AUDIT.md`
- `docs/work-packets/*.yaml`
- `docs/templates/*`
- `scripts/check-work-packets.mjs`

These files are public maintenance evidence. They should be sanitized, scoped, and useful to a future maintainer reviewing why work happened.

Keep these out of git:

- `.env`, tokens, credentials, and local policy overrides.
- `.codex-slack/`, local queues, SQLite/JSON runtime state, logs, caches, and worktrees.
- Raw Codex transcripts, raw Slack payload dumps, prompt dumps, command-output dumps, and secret-bearing debugging notes.
- Machine-specific private notes, local absolute paths when avoidable, customer data, and sensitive Slack thread text.
- Unapproved diagrams, logos, screenshots, generated visual candidates, and rejected assets.
- Temporary subagent scratch files that do not become intentional documentation or tests.

Work packets should summarize evidence without copying sensitive source material. If a packet needs to mention a private artifact, reference the class of evidence rather than embedding the content.

## Delegated Work

When work is split across subagents, keep the split visible in `docs/TASKS.md` and use disjoint ownership whenever possible.

The detailed maintenance model lives in `docs/AGENT_ORCHESTRATION.md`, and the reusable pattern is documented in `docs/CUSTODY_FIRST_ORCHESTRATION.md`. Use `docs/templates/DELEGATION_PACKET.md` for the assignment and `docs/templates/SUBAGENT_HANDOFF.md` for longer handoffs.

Record each delegated chunk with:

- `owner`: main agent, subagent, or reviewer.
- `scope`: the exact files or directories assigned.
- `status`: `Ready`, `Active`, `Blocked`, `Review`, `Verify`, `Done`, or `Deferred`.
- `verification`: command run or manual check completed.
- `handoff`: the next action, if any.

If two chunks might touch the same files, mark the overlap and serialize the work instead of running them in parallel.

## Task States

Use these headings in `docs/TASKS.md`:

- `Active`: currently being worked.
- `Next`: ready to pull.
- `Done`: completed and verified.
- `Deferred`: intentionally out of current release scope.

## Task Entry Format

Prefer concise, outcome-oriented task entries:

```text
- Add repo/channel/user authorization policy with tests and runbook docs.
```

For delegated work, include the owner and verification inline when useful:

```text
- owner: subagent-a
  scope: apps/slack-gateway/src/listeners/*
  status: Review
  verification: npm test
  handoff: wait for policy review
```

Avoid vague entries:

```text
- Improve security.
```

## Release Tracking

For `v0.1.0`, every release-blocking item should be visible in `docs/ROADMAP.md` or `docs/TASKS.md`.

Before tagging:

1. Move completed release work to `Done`.
2. Move incomplete non-blockers to `Deferred`.
3. Update `CHANGELOG.md`.
4. Confirm `npm run check` passes.
5. Record any final release decision in `docs/DECISIONS.md`.

## Machine Checks

Run:

```bash
npm run check:work-packets
```

This validates the packet schema, detects overlapping active path or concern ownership, requires objective/non-goals/verification/handoff criteria for active work, and requires completed verification, evidence, reviewer, commit, and maintenance audit closure for done packets.
