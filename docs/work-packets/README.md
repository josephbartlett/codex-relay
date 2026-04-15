# Work Packets

Work packets are the machine-readable form of Custody-First Orchestration.

Each `*.yaml` file describes one bounded unit of work:

- who owns it
- what the concrete objective is
- what paths it may touch
- what named concerns it owns, if path ownership is not precise enough
- what it must not do
- how completion will be verified
- what handoff evidence is expected or completed
- what maintenance audit evidence closes it

Run:

```bash
npm run check:work-packets
```

The checker enforces:

- packet schema validity
- no duplicate packet IDs
- no overlapping active/review/verify owned paths or named concerns
- `objective`, `non_goals`, `verification.required`, and `handoff.expected` on active/review/verify packets
- completed verification, verification evidence, handoff evidence, reviewer, checks, completion date, and commit SHA on done packets

## Required Shape

```yaml
id: CFO-0000
title: Short task title
status: ready
owner: unassigned
role: worker
priority: p1
objective: Concrete outcome for this packet.
paths:
  - apps/example/src
concerns:
  - concern:authorization-policy
dependencies:
  - CFO-0001
non_goals:
  - Do not change unrelated Slack listeners.
acceptance:
  - Observable behavior or documentation outcome.
verification:
  required:
    - npm test
  completed: []
  evidence: []
handoff:
  expected:
    - Worker reports changed files, verification, risks, and next action.
  completed: []
  next: []
risks:
  - What could go wrong.
maintenance_audit:
  assigned_at: "2026-04-13"
  notes:
    - Human-readable maintenance note.
```

Use `concerns` when ownership cannot be represented by paths alone. The checker also accepts `concern:*` or `module:*` entries in `paths`, but the explicit `concerns` field is clearer.

Start new packets from `docs/templates/WORK_PACKET.yaml`, then adapt the role-specific Markdown template in `docs/templates/*_PACKET.md` for the assignment or handoff text.

Status values:

- `ready`
- `active`
- `blocked`
- `review`
- `verify`
- `done`
- `deferred`

Roles:

- `lead`
- `worker`
- `explorer`
- `reviewer`
- `verifier`
- `release`
