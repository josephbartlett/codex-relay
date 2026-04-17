# Full-Build Roadmap

This roadmap defines what "fully built" means for Codex Relay and tracks the path from the current local MVP to a durable solo/team product.

## Target Definition

Codex Relay is fully built when it can reliably run day-to-day engineering tasks from Slack with durable state, explicit approvals, isolated workspaces, GitHub PR handoff, auditable policies, and a path to multiple runners. Slack is the first control plane; the architecture should stay open to additional local-first control planes where they preserve the same safety and audit model.

## Non-Negotiable Acceptance Criteria

- Slack thread continuity works for new tasks, follow-ups, approvals, cancellations, PR creation, and status review.
- Relay-started local sessions can post Slack completion summaries and continue from the bound Slack thread.
- Approved implementation writes run in session worktrees by default and never touch a developer's active branch unless direct workspace quick mode is explicitly enabled for a trusted repo.
- Users, channels, and repos are authorized before any Codex run starts.
- Risky state transitions require explicit Slack button approval from the task owner or an authorized maintainer.
- State survives process restarts without losing sessions, approvals, PR metadata, or queue entries.
- Human-readable audit events are available in Slack and a local read-only viewer.
- Custody-First Orchestration packets track release-blocking work with ownership, verification, and maintenance audit evidence.
- Duplicate Slack actions are idempotent where practical.
- GitHub PR creation and update flows are traceable from the session state.
- `npm run check` includes typecheck, build, tests, and secret scanning.
- Public security docs and threat model are current.
- Operational docs cover setup, testing, recovery, cleanup, and security posture.
- Tests cover planner/execute flow, persistence reload, authorization, PR creation, duplicate actions, queue behavior, and command argument compatibility.

## Phase 1: Durable Local Product

Goal: make solo local mode dependable enough for regular use.

- Add SQLite-backed persistence with JSON migration.
- Keep active process handles in memory, but persist all durable session/run/approval/PR state.
- Add config validation for storage mode and database paths.
- Add idempotency for approval, cancellation, and PR actions.
- Add Slack status views that can recover useful session information after restart.
- Expand tests for restart/reload behavior.

Exit criteria:

- A restart preserves existing sessions, pending approvals, completed runs, and draft PR metadata.
- The gateway can run with `CODEX_STORE_KIND=sqlite`.
- JSON remains supported only as a local compatibility fallback.

## Phase 2: Policy And Authorization

Goal: prevent accidental use from the wrong Slack surface or against the wrong repo.

Status: implemented for local `v0.1.0` scope.

- Add user allowlists and optional maintainer roles.
- Add channel allowlists.
- Add per-repo allowed Slack users/channels.
- Add policy checks before plan, approve, cancel, cleanup, diff, and PR creation actions.
- Add Slack-visible denial messages that do not leak repo paths or secrets.
- Document policy configuration and defaults.

Exit criteria:

- Unauthorized users cannot start, approve, inspect, cancel, or create PRs.
- Tests cover allowed and denied access for each mutating action.

## Phase 3: Slack UX Completion

Goal: make Slack usable as a control plane instead of just a demo surface.

- Add richer follow-up intent handling in threads. Status: implemented for local `v0.1.0` scope.
- Support "continue", "revise plan", "run tests", "summarize diff", "update PR", "ready for review", and "cancel" intents. Status: implemented for current local scope.
- Add App Home pending approvals, recent sessions, and audit visibility. Status: implemented for current local scope.
- Add richer App Home session detail cards and runner status. Status: deferred.
- Add human-readable audit summaries for user-visible lifecycle events.
- Add authenticated remote audit dashboard mode for operator deployments. Status: implemented for local `v0.1.0` scope.
- Add message updates for major state changes without spamming channels.
- Add better modal detail views for plan, diff, logs, and PR metadata.
- Add local session handoff for runs started from the developer machine but continued through Slack. Status: implemented for Relay-started queued sessions; arbitrary attach remains deferred.

Exit criteria:

- A user can manage an entire task lifecycle from Slack mobile without needing terminal output.
- A user can start work locally through Relay, leave, receive a Slack completion summary, and continue in the same Slack thread.
- A user can ask read-only codebase questions without entering the implementation pipeline.

## Phase 4: GitHub Lifecycle

Goal: make PR handoff robust enough for real repos.

- Store PR metadata on sessions.
- Update existing draft PRs from subsequent completed runs. Status: implemented for local `v0.1.0` scope.
- Add optional ready-for-review action. Status: implemented for local `v0.1.0` scope.
- Add CI/check status polling. Status: compact `gh pr view` status counts plus capped per-check Slack detail implemented; deeper CI log ingestion deferred.
- Add PR comment/status summary back into Slack. Status: compact status summary and bounded check detail implemented.
- Add guardrails around dirty worktrees and branch divergence. Status: detached HEAD, wrong branch, staged index, unsafe clean recovery, and behind-upstream PR handoff checks implemented.

Exit criteria:

- A session can create a draft PR, update it after follow-up changes, and report compact PR/check status.

## Phase 5: Team-Mode Foundation

Goal: separate Slack control-plane work from runner execution.

- Add a durable task queue table. Status: implemented for local `v0.1.0` foundation.
- Add runner leases and heartbeat state. Status: implemented for local `v0.1.0` foundation.
- Keep Socket Mode gateway as one deployable process, but allow worker processes to claim queued work.
- Add concurrency limits per repo/session. Status: represented in queue claim options and SQLite claim checks.
- Add recovery for abandoned leases. Status: implemented in `DurableQueue`.
- Add worker startup checks. Status: local runner daemon reuses startup checks.
- Add asynchronous Slack progress publishing for queued runner work. Status: durable notification records and gateway publisher implemented for major lifecycle changes.

Exit criteria:

- The gateway can enqueue work and a separate local worker can execute it. Status: queue/daemon API implemented; queued-run lifecycle notifications can be delivered by the Slack gateway. Full Slack UX conversion from direct execution to queued execution remains follow-on work.

## Phase 6: Runner Hardening

Goal: make execution policy explicit and testable.

- Add runner profiles for read-only, write, PR, and cleanup operations. Status: implemented for local `v0.1.0` scope.
- Validate Codex exec policy/rules at startup where supported. Status: startup posture checks implemented; unsupported CLI validation is warning-only.
- Add environment-variable allowlists for runner child processes. Status: implemented for `ExecAdapter`.
- Add network policy flags per repo/task profile.
- Add artifact retention and cleanup rules. Status: implemented for local `v0.1.0` scope with owner-scoped cleanup policy and bounded ephemeral diff artifacts.

Exit criteria:

- Startup clearly reports unsafe runner config before accepting Slack work.

## Phase 7: Packaging And Operations

Goal: make install, upgrade, and recovery boring.

- Add `.env.example` coverage for every config option. Status: setup validator enforces coverage.
- Add setup validation command. Status: implemented as `npm run validate:setup`.
- Add Docker/local service examples. Status: starter examples documented for local/self-hosted deployments.
- Add backup/restore notes for SQLite state. Status: documented in the runbook.
- Add smoke-test scripts for Slack-less local flows. Status: setup validator runs without live Slack credentials.
- Add release checklist. Status: release process includes setup validation and backup/restore review.
- Add release-readiness gate. Status: automated with `npm run check:release`; final live Slack smoke test remains manual before tagging.

Exit criteria:

- A fresh install can be validated without using a real Slack task.

## Phase 8: Custody-First Extraction

Goal: extract the generic pattern scaffold only after it is proven inside this repo.

- Validate machine-readable work packets through at least one additional implementation packet.
- Separate generic templates, checker, and docs from Codex Relay-specific case study content.
- Create a clean external scaffold/repo only after the pattern is stable.

Exit criteria:

- A separate Custody-First scaffold can be generated without project-specific paths, secrets, Slack IDs, or Codex Relay assumptions.

## Future Path: Email Control Plane

Goal: support email as an optional local-first control plane alongside Slack for environments where a developer wants remote task dispatch without exposing a public HTTP endpoint.

Status: outbound SMTP notifications, inbound IMAP plan/ask intake, reply-to-email continuation, and gated direct workspace commands are implemented and disabled by default where appropriate. Email-originated approvals remain future work.

Why it belongs:

- Email can provide a mobile-friendly command surface without requiring a public inbound webhook to the developer machine.
- A local bridge or mail-ops daemon can play the same transport-boundary role that Socket Mode plays for Slack.
- Email is naturally asynchronous, which fits plan/approve/execute/status workflows better than terminal-style streaming.
- This path should broaden Codex Relay's control-plane adapters without changing the runner trust boundary.

Candidate shape:

- Use an existing local mail bridge or polling daemon as the transport boundary, such as an IMAP/SMTP bridge-backed workflow.
- Treat email as another control-plane adapter that creates the same sessions, task runs, approvals, queue jobs, and audit events used by Slack.
- Keep the runner side unchanged: Codex execution still happens through the orchestrator, queue, workspace manager, and runner adapters.
- Use strict sender allowlists, mailbox/folder scoping, signed or nonce-based approval replies, and conservative parsing before any mutating action.
- Prefer plain-text summaries, compact status replies, and linked local/audit artifacts over terminal-style output.
- Investigate reusable local mail-bridge patterns as a dedicated adapter track.

Possible local architecture:

```text
Email client / mobile mailbox
  -> local IMAP/SMTP bridge
    -> local mail polling daemon
      -> Codex Relay Email Adapter
        -> Orchestrator + queue + audit
          -> local/self-hosted runner
```

Exploration phases:

1. Discovery: review local mail-bridge patterns and identify reusable polling, parsing, reply, and state-management pieces.
2. Foundation: parse allowlisted plain-text commands into read-only plan and ask/query requests without write approvals. Status: implemented.
3. Outbound notifications: send compact SMTP summaries for plan-ready, completed, and failed runner events. Status: implemented behind disabled-by-default config.
4. ADR: define the live adapter boundary, authentication model, allowed mailbox/folder scopes, reply approval format, and raw-message retention policy. Status: read-only boundary accepted; write approval format remains future work.
5. Prototype: convert an allowlisted plain-text email into a read-only plan or ask task and send a compact reply without Slack credentials. Status: implemented behind disabled-by-default config.
6. Reply continuation: route replies containing `relay:<sessionId>` back to the existing Relay session. Status: implemented as a routing hint, not an approval token.
7. Direct workspace opt-in: support explicit `quick`/`direct` email commands only when both global and email-specific gates are enabled. Status: implemented for trusted solo repos.
8. Approval loop: add nonce-bound or signed approval replies for execute-plan only, with expiry and audit records.
9. Adapter hardening: add duplicate-message handling, attachment policy, retry behavior, redaction, and operator diagnostics.

Non-goals for initial exploration:

- Do not make Codex Relay an email server.
- Do not ingest arbitrary inboxes by default.
- Do not accept write approvals from unauthenticated or weakly matched email replies.
- Do not treat `relay:<sessionId>` as authentication or approval.
- Do not store full raw email bodies unless explicitly enabled by deployment policy.
- Do not let the email path weaken the existing Slack security model.

Exit criteria for a future packet:

- A design ADR defines the email adapter boundary, authentication model, state mapping, and failure modes.
- A prototype can convert an allowlisted local email command into a read-only plan task without Slack credentials.
- Human-readable audit records show the source mailbox/folder/message id without storing sensitive raw mail content.
- Slack and email adapters produce the same core task/audit records so downstream runner behavior remains transport-agnostic.

## Future Path: Additional Control Planes

Goal: support additional operator surfaces without weakening the runner boundary.

Discord is a candidate adapter because community and small-team engineering work often already happens there, and the same mention/thread/approval/status model can map to Discord channels or threads. It should not become a separate execution path.

Adapter rules:

- reuse the orchestrator, queue, persistence, audit, authorization, and runner adapters;
- keep provider identity and permission checks explicit and fail-closed;
- keep write approvals button- or nonce-bound, never inferred from plain text alone;
- keep progress summaries compact and avoid terminal-style streaming;
- keep each provider adapter optional and disabled by default.

Exit criteria for any new control-plane adapter:

- a design ADR defines the transport boundary and identity model;
- adapter-originated sessions produce the same task, queue, notification, and audit records as Slack/email where practical;
- security docs explain spoofing, replay, retention, and approval risks for the adapter;
- provider-specific credentials and local endpoint values stay out of tracked docs and work packets.

## Current Build Order

1. Keep the public Slack/local-session path stable while adding new adapters behind disabled-by-default configuration.
2. Keep lightweight ask/query mode available for informational questions without approval or PR handoff.
3. Keep direct workspace quick mode opt-in, repo-scoped, and clearly separated from the default worktree pipeline.
4. Before normal live use, update protected local `.env` strict-mode Slack allowlists and run `npm run validate:live-config`.
5. Promote tracked brand assets only after rendered screenshot review and explicit maintainer approval.
6. Keep arbitrary attach to pre-existing terminal Codex sessions deferred until Codex session/workspace provenance can be captured safely.
7. Keep email-originated write approval behind a future nonce-bound or signed approval design.
8. Keep external Custody-First scaffold work tabled unless explicitly reopened.
