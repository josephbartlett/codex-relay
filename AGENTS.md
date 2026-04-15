# Agent Operating Guide

This repository is intended to be maintained by humans and coding agents. Agents must preserve repo hygiene, secrets hygiene, and release discipline from the beginning.

## Prime Directive

Build Codex Relay as a production-shaped Slack control plane for local and self-hosted Codex execution. Favor durable, testable, documented changes over demo-only shortcuts.

## Safety Rules

- Never print, commit, move, overwrite, or normalize `.env` secrets.
- Do not edit `.env` unless the user explicitly asks for a specific change.
- Keep `.codex-slack/`, `dist/`, `node_modules/`, logs, worktrees, tokens, and generated local runtime state out of git.
- Do not use `danger-full-access`, `--yolo`, or equivalent unsafe Codex execution defaults in product code.
- Preserve workspace isolation: approved write tasks must run in session worktrees, not a user's active branch.
- Do not revert user changes unless explicitly requested.

## Engineering Standards

- Use TypeScript with strict typechecking.
- Keep Slack gateway, orchestrator, local runner, shared types, infra, and docs boundaries clear.
- Prefer existing local patterns over new abstractions.
- Add abstractions only when they remove real duplication or define a durable boundary.
- Treat Slack messages, Codex prompts, command output, and diffs as sensitive data.
- Make state transitions idempotent where Slack retries or duplicate button clicks are plausible.

## Custody-First Workflow

- Use Custody-First Orchestration for all non-trivial repository work.
- Create or activate a machine-readable packet in `docs/work-packets/` before starting a meaningful implementation, release, security, governance, or visual-asset chunk.
- Keep packet ownership narrow: one owner, exact paths or named concerns, explicit non-goals, acceptance criteria, verification, risks, and handoff expectations.
- Keep active/review/verify packet scopes disjoint. If two packets may touch the same files or concern, serialize the work.
- Run `npm run check:work-packets` whenever packet state changes.
- Do not mark a packet `done` without completed verification, evidence, handoff notes, reviewer/verifier, date, checks, and commit or artifact reference.
- Record maintenance history in `docs/MAINTENANCE_AUDIT.md` and active status in `docs/TASKS.md`.
- External Custody-First scaffold work is currently tabled. Do not edit any external scaffold repository unless the user explicitly reopens that project.

## Delegation Workflow

- Use `docs/AGENT_ORCHESTRATION.md` as the source of truth for multi-agent maintenance.
- Use subagents for chunks that can be owned independently, verified independently, and merged without overlapping file ownership.
- Split work by path or concern before launching subagents. Assign one owner per disjoint file set, and avoid shared edits unless the task is explicitly serial.
- Keep one subagent on implementation and a separate subagent on review or verification when that can surface bugs earlier.
- Start non-trivial delegated work with a packet shaped like `docs/templates/DELEGATION_PACKET.md`.
- Require each delegated chunk to end with a verification step: the commands run, the files touched, and the result.
- Record delegated work in `docs/TASKS.md` with the owner, scope, status, and verification result.
- Do not assign a subagent any task that needs judgment on release policy, security posture, or repo-wide architecture unless the scope is narrowed first.
- If a task might touch the same files as another active task, coordinate in the main thread first and serialize the work.
- Before handoff back to the main agent, each subagent should report what it changed, what it verified, and any remaining risks.

## Visual Asset Rules

- Keep generated logos, diagrams, screenshots, and brand candidates untracked until the user explicitly approves them.
- Do not approve visual assets from SVG/source inspection alone.
- Visual assets require rendered screenshot review, including desktop and mobile/narrow viewport checks.
- Check for overlap, clipping, unintended symbols, label legibility, contrast, and overall composition before proposing tracked assets.
- If visual candidates are rejected, record the reason and improve the gate before generating or promoting more assets.

## Required Checks

Run these before a checkpoint commit unless the change is docs-only:

```bash
npm run typecheck
npm run build
npm test
```

For docs-only changes, run at least:

```bash
npm run check:work-packets
npm run typecheck
```

## Documentation Discipline

- Update `docs/TASKS.md` when work starts, moves, or finishes.
- Update `docs/DECISIONS.md` or add an ADR for durable design decisions.
- Update `docs/ROADMAP.md` when scope or delivery order changes.
- Update `docs/RUNBOOK.md` for setup, operations, recovery, or command changes.
- Update `docs/SECURITY.md` for authorization, sandboxing, policy, or data-handling changes.
- Use `CHANGELOG.md` for release-facing changes.

## Commit Discipline

- Use Conventional Commits.
- Make checkpoint commits that are coherent and reviewable.
- Prefer one large, meaningful checkpoint over many tiny mixed commits.
- Small commits are appropriate for isolated bug fixes, broken build fixes, or documentation corrections.
- Do not commit broken tests unless the commit is explicitly marked as a failing reproduction.
- Local commits are allowed when they are needed to checkpoint verified work.
- Do not push commits, tags, releases, or repository-setting changes without explicit maintainer approval in the current conversation.
- For the public repository, default to branch-and-PR handoff. Direct pushes to `main` are allowed only when the maintainer explicitly asks for that exact push.

## Release Discipline

- This project uses Semantic Versioning.
- `v0.1.0` was the first official release.
- Do not tag a release until tests pass, docs are current, and `CHANGELOG.md` has a release entry.
- Do not tag or publish a release without explicit maintainer approval in the current conversation.
- Release tags must use `vMAJOR.MINOR.PATCH`.

## Current Product Shape

Slack is the control plane. Codex is the execution plane. Skills/plugins/MCP are reusable behavior inside the runner.

The product is not fully built until durable persistence, authorization policy, Slack lifecycle UX, GitHub PR lifecycle, queue/runner split, runner hardening, and release hygiene are complete enough for regular local-first operation.
