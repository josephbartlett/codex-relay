# Documentation Guide

Documentation is part of the product. Keep it current with code and release decisions.

## Public Docs Map

- `README.md`: project overview, quick start, and current capabilities.
- `SECURITY.md`: public vulnerability reporting and security posture.
- `CHANGELOG.md`: release-facing change history.
- `CONTRIBUTING.md`: contribution, testing, and PR expectations.
- `AGENTS.md`: operating rules for coding agents.
- `docs/ROADMAP.md`: public delivery roadmap and acceptance criteria.
- `docs/TASKS.md`: current task state.
- `docs/TASK_MANAGEMENT.md`: tracked versus untracked orchestration policy and task-system rules.
- `docs/DECISIONS.md`: durable decision log.
- `docs/ADRs/`: architecture decision records.
- `docs/AGENT_ORCHESTRATION.md`: multi-agent ownership, delegation, handoff, and verification model.
- `docs/CUSTODY_FIRST_ORCHESTRATION.md`: shareable pattern spec for custody-first multi-agent maintenance.
- `docs/MAINTENANCE_AUDIT.md`: human-readable maintenance audit rollup.
- `docs/work-packets/`: machine-readable custody packets and packet README.
- `docs/templates/DELEGATION_PACKET.md`: reusable packet format for delegated work.
- `docs/templates/SUBAGENT_HANDOFF.md`: reusable handoff report format.
- `docs/templates/WORK_PACKET.yaml`: machine-readable packet seed.
- `docs/templates/*_PACKET.md`: role-specific packet templates.
- `docs/case-studies/`: public case studies for the pattern and project.
- `docs/RUNBOOK.md`: setup, operations, and recovery.
- `docs/SECURITY.md`: technical security model.
- `docs/BRAND.md`: brand and asset workflow.

## Writing Rules

- Prefer concrete behavior over vague claims.
- Document defaults, limitations, and failure modes.
- Keep setup commands copy-pasteable.
- Do not include real tokens, workspace IDs, private repo paths, customer names, or sensitive Slack text.
- When documenting a new config variable, update `.env.example`, `README.md`, and `docs/RUNBOOK.md`.
- When documenting a security-relevant change, update top-level `SECURITY.md` or `docs/SECURITY.md`.

## Change Checklist

For each meaningful change, decide whether to update:

- `docs/TASKS.md`
- `docs/DECISIONS.md`
- `docs/ROADMAP.md`
- `docs/RUNBOOK.md`
- `docs/SECURITY.md`
- `CHANGELOG.md`

If none are updated, the PR should explain why.
