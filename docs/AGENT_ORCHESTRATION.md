# Agent And Subagent Orchestration

Codex Relay is maintained as a multi-agent-friendly repository. The goal is not to maximize parallelism; the goal is to make parallel work safe, reviewable, and useful.

This guide is the repo-specific operating guide. The shareable pattern is documented in `docs/CUSTODY_FIRST_ORCHESTRATION.md`.

## Operating Model

The main agent is the release lead for the current turn. Subagents are temporary owners of bounded work packets.

| Role | Purpose | Write access |
| --- | --- | --- |
| Lead | Owns scope, sequencing, final integration, commits, and release hygiene. | Any needed path, after checking active ownership. |
| Worker | Implements a bounded task with explicit path ownership. | Only assigned paths. |
| Explorer | Answers a specific codebase question. | None. |
| Reviewer | Looks for bugs, security gaps, missing tests, and documentation drift. | None unless explicitly reassigned as a worker. |
| Verifier | Runs targeted checks or manual QA against a finished chunk. | None, except generated reports when assigned. |

One person or agent can hold multiple roles over time, but a single delegated packet should have exactly one accountable owner.

## Non-Negotiable Rules

- Define ownership before parallel work starts.
- Create or activate a machine-readable work packet before non-trivial implementation, release, security, governance, or visual-asset work starts.
- Prefer disjoint file paths over shared ownership.
- Do not let two active agents edit the same file set.
- Do not delegate secrets handling, release tagging, destructive git cleanup, or security-policy changes without a narrow written scope.
- Treat Slack text, local state, prompts, diffs, logs, and screenshots as sensitive.
- Every delegated packet ends with a handoff report.
- The lead reviews the touched file list before integration.
- `npm run check` is the default final gate for code changes.
- External Custody-First scaffold work is tabled until the user explicitly reopens it.

## Delegation Packet

Every non-trivial subagent assignment should include:

- Objective.
- Owned paths.
- Explicit non-goals.
- Acceptance criteria.
- Verification command or manual QA requirement.
- Handoff format.
- Conflict warning: the subagent is not alone in the codebase and must not revert unrelated changes.

Use `docs/templates/DELEGATION_PACKET.md` for repeatable packets.

For role-specific packet starts, use:

- `docs/templates/IMPLEMENTATION_PACKET.md`
- `docs/templates/EXPLORER_PACKET.md`
- `docs/templates/SECURITY_REVIEW_PACKET.md`
- `docs/templates/VERIFIER_PACKET.md`
- `docs/templates/RELEASE_PACKET.md`

For machine-readable tracking, start from `docs/templates/WORK_PACKET.yaml` and create a YAML packet in `docs/work-packets/`.

## Handoff Report

Each subagent should return:

- Files changed.
- What was implemented or discovered.
- Verification performed.
- Known limitations or risks.
- Suggested next action.

Use `docs/templates/SUBAGENT_HANDOFF.md` when a longer report is useful.

## Work States

Use these states in `docs/TASKS.md`, GitHub issues, and handoffs:

| State | Meaning |
| --- | --- |
| `Ready` | Scoped enough to start. |
| `Active` | Currently owned by a human or agent. |
| `Blocked` | Cannot proceed without a decision or dependency. |
| `Review` | Implementation is complete and needs inspection. |
| `Verify` | Review passed and checks/manual QA are running. |
| `Done` | Merged or committed with verification recorded. |
| `Deferred` | Intentionally outside current release scope. |

## Ownership Ledger

For larger work, record active ownership in `docs/TASKS.md` using this shape:

```text
- owner: lead
  scope: apps/orchestrator/src/tasks.ts; packages/shared/src/authorization.ts
  status: Active
  objective: Enforce Slack authorization in the orchestrator.
  verification: npm test
  handoff: Update security docs and run full check.
```

Keep entries short. The ledger is a coordination tool, not a diary.

Machine-readable ownership lives in `docs/work-packets/*.yaml`. Run:

```bash
npm run check:work-packets
```

The checker rejects overlapping active path or concern ownership, missing verification plans, missing handoff expectations, and incomplete verification/audit evidence for done packets.

## Repository Tracking Policy

The tracked orchestration system is the durable maintenance layer: packet YAML, task tracker, maintenance audit, decision log, templates, and checker scripts. These artifacts make ownership, verification, and release history reviewable.

The untracked orchestration residue is the local execution layer: runtime state, queues, logs, worktrees, raw transcripts, raw Slack/Codex payloads, secret-bearing debugging notes, generated candidates, and machine-specific scratch. These artifacts can be sensitive or too noisy for public history.

Use `docs/TASK_MANAGEMENT.md` as the detailed source of truth for tracked versus untracked orchestration state.

## Parallelization Heuristics

Good packets:

- A read-only reviewer checking a completed patch.
- A worker adding docs in paths the lead will not touch.
- A worker creating ignored brand candidates while tracked code changes continue separately.
- A verifier running browser screenshots or command checks against finished UI/assets.

Poor packets:

- Two workers editing the same listener files.
- A broad "improve security" task with no exact files or acceptance criteria.
- A worker changing release policy while another worker updates release docs.
- Any task requiring access to `.env`, credentials, or local private content.
- A visual asset approval based only on SVG/source inspection without rendered screenshots.

## Review Gates

The lead should review in this order:

1. `git status --short` to identify all touched files.
2. Path ownership: confirm subagents stayed inside assigned scope.
3. Focused diff review for behavior, security, and docs drift.
4. Targeted tests for the changed area.
5. Full `npm run check` before commit when code changed.
6. `docs/TASKS.md`, `docs/DECISIONS.md`, and `CHANGELOG.md` updates when release-facing behavior changed.

Visual assets have an additional maintainer gate:

- rendered screenshot review at desktop and mobile/narrow widths
- overlap, clipping, unintended-symbol, legibility, contrast, and framing checks
- explicit maintainer approval before moving ignored candidates into tracked assets

## Security Review Prompt

Use a read-only reviewer for any change touching:

- Slack authorization.
- Repo binding or path resolution.
- Worktree creation, cleanup, commit, push, or PR creation.
- Runner sandbox, approval policy, network, or environment.
- Persistence schema, migration, or queue semantics.
- Logs, prompts, diffs, command output, screenshots, or tokens.

The reviewer should prioritize exploitable paths and missing tests over style.

## Maintenance Cadence

Before each meaningful checkpoint commit:

- Move completed items in `docs/TASKS.md`.
- Record durable decisions in `docs/DECISIONS.md` or an ADR.
- Update release-facing notes in `CHANGELOG.md`.
- Confirm docs mention any new config variables.
- Run `npm run check:work-packets`.
- Run the relevant verification gate.

Prefer one coherent checkpoint commit that includes implementation, tests, docs, packet status, and audit notes. Use a separate closure commit only when the packet was missed, release metadata must be recorded after the fact, or another real sequencing constraint exists.

Before a release:

- Confirm every release-blocking roadmap item is `Done` or explicitly `Deferred`.
- Run `npm run check`.
- Re-read `SECURITY.md`, `docs/SECURITY.md`, and `docs/RUNBOOK.md`.
- Confirm ignored assets and local runtime files are not staged.
- Tag only after the release commit is clean.

## Public Collaboration

When this repository is open to outside contributors, GitHub issues can use the same packet structure. A public issue should be assignable to a human or agent without requiring hidden context.

Good public task descriptions include:

- Exact user/operator problem.
- Files likely involved.
- Security impact.
- Tests expected.
- Documentation expected.
- Out-of-scope items.
