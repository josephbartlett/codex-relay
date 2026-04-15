# Case Study: Codex Relay Builds Itself

Codex Relay is a good case study for Custody-First Orchestration because the project was built with the same pattern it is now describing.

This is not a retrospective marketing story. It is a practical record of how a small repo stayed organized while it added Slack control-plane behavior, local runner orchestration, security policy, structured audit logging, release hygiene, and public documentation.

## Starting Point

The first milestone was a local-first Slack harness that could:

- accept `@Codex` mentions and slash commands
- route tasks into isolated worktrees
- run a two-phase plan and execute flow
- create draft pull requests
- keep a minimal but durable state store

From there, the repo needed more than features. It needed a maintenance system that could survive parallel work without turning into a pile of implicit decisions.

That is where Custody-First Orchestration became useful.

## How The Pattern Shaped The Work

### 1. Every packet had a named owner

The repo did not treat “the agent” as a single giant worker. Instead, work was split into packets with short, visible ownership records.

That made it possible to run focused work on:

- release docs
- authorization policy
- audit logging
- branding and diagrams
- reviewer-only security passes

The important part was not speed. It was making ownership legible.

### 2. Work was separated by custody boundaries

The repo used disjoint scopes so subagents could work without stepping on each other.

Examples:

- one packet for orchestration and authorization
- one packet for docs and process
- one packet for branding candidates
- one packet for verification and review

That reduced accidental overlap and made review much simpler.

### 3. Verification was part of the packet, not an afterthought

Each meaningful chunk had a verification plan.

For code changes, that meant tests and a final check run.
For diagrams and mockups, that meant opening the assets in a browser and visually inspecting them.
For docs, that meant confirming the language matched the actual behavior.

The rule was straightforward: if the work could not be verified, it was not ready to merge.

### 4. Security stayed in the lead role

Security-sensitive changes were handled as first-class custody packets rather than hidden behind generic cleanup.

That mattered for:

- Slack authorization
- repo binding
- worktree scope
- local runner constraints
- audit visibility

The repo treated policy as product behavior, not just a configuration detail.

### 5. Audit was human-readable

The project added a human-readable audit layer because the maintenance process needed to be inspectable without reading raw logs.

That audit layer records lifecycle events, approvals, failures, summaries, and release-relevant actions in plain language.

It is lightweight on purpose. The point is not to create a forensic warehouse. The point is to make day-to-day operation understandable.

## What The Repo Used As Evidence

The case study is not only code. It also includes review assets that were kept outside version control until human review.

Those assets show the visual side of the control plane:

- `brand-candidates/architecture-codex-relay-full.svg`
- `brand-candidates/architecture-agent-orchestration.svg`
- `brand-candidates/architecture-security-boundaries.svg`
- `brand-candidates/audit-trail.svg`
- `brand-candidates/audit-dashboard.html`

They were generated as review-only artifacts and inspected in a browser before any decision to promote them.

That is a small but important custody rule: design assets can be part of the system without being part of the tracked release until they are approved.

## What Worked Well

### Clear scope boundaries

The repo avoided the common failure mode where a second agent quietly expands the first agent’s work.

### Public planning files

Task state was visible in the repo instead of trapped in a private message thread.

### Durable decisions

When the repo made a policy or architecture decision, it recorded the reason in a durable doc instead of relying on memory.

### Review before merge

The process made room for reviewer-only passes and verifier-only passes, which surfaced problems earlier.

### Release discipline from the start

The repo treated semver, changelog discipline, docs, and security posture as part of the build, not as cleanup work after the fact.

## Where The Pattern Still Has Room To Grow

This case study is strong, but it also shows the next step.

The pattern gets even better when the custody packet becomes machine-readable enough to power:

- conflict checks for overlapping scopes
- release-ready task dashboards
- public GitHub issue templates
- audit summaries that can be regenerated from the packet history

That is the bridge from a disciplined internal workflow to a shareable operating pattern.

## Practical Lesson

The main lesson is not “use more agents.”

The lesson is:

**Use fewer assumptions, narrower scopes, and better handoffs.**

Once those are in place, multiple agents become useful instead of risky.

That is what made it possible for Codex Relay to build itself while staying readable, reviewable, and release-aware.

## Why This Matters For Other Repos

Most teams do not need a flashy agent framework. They need:

- a way to divide work without creating hidden collisions
- a way to review work without reading the full discussion
- a way to prove the work was checked
- a way to keep the release line clean

Custody-First Orchestration is a small enough pattern to adopt and a strong enough pattern to share.

Codex Relay used it to build:

- the Slack execution path
- the orchestrator and runner model
- the security policy layer
- the structured audit layer
- the public docs and release hygiene
- the review-only brand and architecture assets

That makes the repo a real example, not just a theory.
