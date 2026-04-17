# Task Tracker

This file is the running implementation tracker for Codex Relay. Keep it current as work lands.

## Active

- owner: lead
  scope: Slack control-plane validation for ask, follow-up, plan/approval, local handoff, status/audit/cleanup, and PR-oriented lifecycle behavior; packet `CFO-0045`
  status: Active
  objective: Verify Slack behaves like a useful mobile extension of Codex CLI without recording local Slack identities, tokens, private channels, or local runtime details.
  verification: `npm run check:work-packets`; `npm run typecheck`; `npm run build`; `npm test`; `npm run check`; `git diff --check`; `npm run validate:live-config`; live Slack smoke if local smoke identity is configured
  handoff: Automated Slack/control-plane tests, Slack bot auth, Socket Mode app-token connectivity, gateway startup, runner startup, manual Slack ask, threaded ask, and plan/approve/worktree execution passed from WSL against a disposable repo. Live smoke found runner-authored local paths in Slack summaries and a details-action session lookup gap; patched live smoke confirmed local-path redaction, approval execution, clean source repo custody, and working diff summary modal behavior.

- owner: lead
  scope: Windows PowerShell live validation of Proton Bridge SMTP smoke, IMAP read-only intake, queued runner plan flow, and redacted outcome capture; packet `CFO-0042`
  status: Active
  objective: Validate the new email control plane live without exposing secrets or enabling email-originated write approvals.
  verification: `git status --short --branch`; `git log --oneline -3`; `npm install`; `npm run typecheck`; `npm run build`; `npm run validate:live-config`; `npm run email:test`; `npm run email:poll`; `npm run check:work-packets`
  handoff: Redacted live-test summary back in the main Codex session. No push, tag, or release.

## Completed Checkpoints

- owner: lead
  scope: Email ask/reply parser hardening, Windows Codex write-sandbox preflight, local-only Slack smoke automation, and continued Proton Bridge validation; packet `CFO-0044`
  status: Done
  objective: Remove live-validation blockers without weakening the default safe execution model or tracking local identities/secrets.
  verification: `npm run check:work-packets`; `npm run typecheck`; `npm run build`; `npm test`; `npm run check`; `git diff --check`; redacted live email validation
  handoff: Parser and self-ingestion fixes are in place; SMTP/IMAP ask, reply continuation, local handoff summary email, and direct-mode intake were validated with redacted evidence. Direct workspace execution remains blocked by Windows Codex write-sandbox denial. CFO-0042 remains open for maintainer acceptance; no push, tag, or release.

- owner: lead
  scope: Slack/email lightweight `ask` mode, gated direct workspace quick mode, source-workspace safety markers, local bridge topology review, and v0.2.0 docs/tests; packet `CFO-0043`
  status: Done
  objective: Add lower-ceremony read-only questions and explicitly opt-in direct workspace edits without weakening the default safe worktree workflow.
  verification: `npm run check`; `git diff --check`; targeted public-risk string scan
  handoff: Included in the local v0.2.0 feature checkpoint. No push, tag, or release was performed.

- owner: lead
  scope: `package.json`; `package-lock.json`; `.env.example`; `apps/email-gateway/src`; `apps/local-runner/src/daemon.ts`; `apps/orchestrator/src/emailNotifications.ts`; `apps/orchestrator/src/persistence`; `packages/shared/src/config.ts`; `packages/shared/src/prompts.ts`; `packages/shared/src/types.ts`; `scripts/validate-setup.mjs`; email tests; setup/store tests; email docs; roadmap/runbook/security docs; packet `CFO-0041`
  status: Done
  objective: Add disabled-by-default IMAP mailbox polling that converts allowlisted email commands into read-only queued plan tasks with durable dedupe and compact replies.
  verification: `npm run check`; `npm run check:audit`; `npm run check:secrets`; `git diff --check`; targeted public-risk string scan
  handoff: Included in the local email feature checkpoint. No push, tag, or release was performed.

- owner: lead
  scope: `package.json`; `package-lock.json`; `.env.example`; `apps/email-gateway/src`; `apps/local-runner/src/daemon.ts`; `apps/orchestrator/src/emailNotifications.ts`; `apps/orchestrator/src/persistence`; `packages/shared/src/config.ts`; `packages/shared/src/types.ts`; `scripts/check-secrets.mjs`; `scripts/validate-setup.mjs`; `tests/email-gateway.test.ts`; `tests/email-notifications.test.ts`; `tests/setup-validator.test.ts`; `tests/sqlite-store.test.ts`; `README.md`; `SECURITY.md`; `CHANGELOG.md`; `docs/DOCUMENTATION.md`; `docs/email`; `docs/ROADMAP.md`; `docs/RUNBOOK.md`; `docs/SECURITY.md`; `docs/work-packets/0040-email-smtp-notifications.yaml`
  status: Done
  objective: Add a generic SMTP outbound notification adapter and local SMTP smoke command without live credentials, provider lock-in, or inbound email control.
  verification: `npm run check`; `git diff --check`; targeted public-risk string scan
  handoff: Included in the local email feature checkpoint. No push, tag, or release was performed.

## Next

- Apply protected local `.env` strict-mode Slack user/channel/repo allowlists and run `npm run validate:live-config` before normal live use.
- Keep email control-plane work behind disabled-by-default adapter boundaries until the ADR and security review are complete.
- Add approved tracked brand assets only after rendered screenshot review and explicit maintainer approval.
- Keep external Custody-First scaffold work tabled unless the user explicitly reopens it.

## Delegated Work Log

- owner: lead
  scope: `.env.example`; `apps/email-gateway/src`; `packages/shared/src/config.ts`; `packages/shared/src/authorization.ts`; `tests/email-gateway.test.ts`; `docs/ROADMAP.md`; `docs/SECURITY.md`; `docs/DECISIONS.md`; `docs/TASKS.md`; `docs/MAINTENANCE_AUDIT.md`; `docs/work-packets/0039-email-control-plane-foundation.yaml`
  status: Done
  objective: Add the first generic email-control-plane foundation without live mailbox credentials, provider-specific setup, or write approvals.
  verification: `npm run check`; `git diff --check`; targeted public-risk string scan
  handoff: Included in the local email feature checkpoint. No push, tag, or release was performed.

- owner: lead
  scope: `CHANGELOG.md`; `package.json`; `package-lock.json`; `docs/RELEASE_READINESS.md`; `docs/TASKS.md`; `docs/MAINTENANCE_AUDIT.md`; `docs/work-packets/0038-v0.1.4-release.yaml`
  status: Done
  objective: Prepare, verify, tag, push, and publish the `v0.1.4` documentation hygiene patch release after explicit maintainer approval.
  verification: `npm run check`; `git diff --check`; targeted public-risk string scan
  handoff: Release metadata commit is `1dee71c`; tag, push, and GitHub release publication follow after final clean-tree gate.

- owner: lead
  scope: `CHANGELOG.md`; `CONTRIBUTING.md`; `docs/DECISIONS.md`; `docs/MAINTENANCE_AUDIT.md`; `docs/RELEASE_PROCESS.md`; `docs/ROADMAP.md`; selected historical work packets
  status: Done
  objective: Sanitize public maintenance wording while preserving the `AGENTS.md` approval guardrails.
  verification: `npm run check`; `npm run typecheck`; `git diff --check`; targeted public-risk string scan
  handoff: Substantive cleanup commit `d25ad04`; packet closure recorded in the follow-up checkpoint. Publication remains maintainer-gated.

- owner: lead
  scope: `README.md`; `docs/CUSTODY_FIRST_ORCHESTRATION.md`; `docs/work-packets/0033-custody-first-public-reference.yaml`
  status: Done
  objective: Link the reusable Custody-First Orchestration scaffold and identify Codex Relay as the proving ground.
  verification: `npm run check:work-packets`; `npm run typecheck`
  handoff: Local commit `e05c279`; publication remains maintainer-gated.

- owner: lead
  scope: `CHANGELOG.md`; `package.json`; `package-lock.json`; `docs/RELEASE_READINESS.md`; `docs/TASKS.md`; `docs/MAINTENANCE_AUDIT.md`; `docs/work-packets/0035-link-official-codex-cli.yaml`; `docs/work-packets/0036-v0.1.3-release.yaml`
  status: Done
  objective: Prepare, verify, tag, push, and publish the `v0.1.3` documentation patch release after explicit maintainer approval.
  verification: `npm run check`; `git diff --check`; targeted public-risk string scan
  handoff: Release metadata commit is `1a8ba87`; tag, push, and GitHub release publication follow after final clean-tree gate.

- owner: lead
  scope: `AGENTS.md`; `CONTRIBUTING.md`; `docs/RELEASE_PROCESS.md`; `docs/DECISIONS.md`; `CHANGELOG.md`; `package.json`; `package-lock.json`; `docs/RELEASE_READINESS.md`; `docs/work-packets/0032-public-publish-approval-policy.yaml`
  status: Done
  objective: Document the explicit maintainer approval boundary for direct pushes, tags, GitHub releases, and repository-setting changes.
  verification: `npm run check`
  handoff: Push, tag, and GitHub release publication for `v0.1.2` completed after maintainer release approval.

- owner: lead
  scope: `README.md`; `SECURITY.md`; `CHANGELOG.md`; `docs/RELEASE_READINESS.md`; `docs/work-packets/0031-public-docs-posture.yaml`; `scripts/release-readiness.mjs`
  status: Done
  objective: Correct stale post-public release/security wording and release-readiness gate wording found during repo sanity audit.
  verification: `npm run check`
  handoff: Remaining repo posture recommendations are branch protection and optional GitHub security-setting review.

- owner: lead
  scope: `packages/shared/src/authorization.ts`; Slack listener auth prechecks; orchestrator auth enforcement; tests; security docs
  status: Done
  objective: Enforce fail-closed Slack user/channel/repo authorization before task start and mutating actions.
  verification: `npm test`
  handoff: Full `npm run check` before commit.
- owner: subagent-reviewer
  scope: read-only review of auth/security and orchestration docs
  status: Done
  objective: Find authorization bugs, missing tests, and public maintenance gaps before commit.
  verification: `npm test`
  handoff: Lead fixed repo-policy precedence and documented the task system.
- owner: subagent-worker
  scope: `brand-candidates/architecture-*.svg`
  status: Done
  objective: Create untracked architecture diagrams for maintainer visual review.
  verification: Browser screenshot review completed during the authorization/audit checkpoint.
  handoff: Keep diagrams untracked until maintainer approval.
- owner: docs-worker
  scope: `docs/CUSTODY_FIRST_ORCHESTRATION.md`; `docs/case-studies/codex-relay-builds-itself.md`
  status: Done
  objective: Create public-facing Custody-First Orchestration spec and case study.
  verification: Lead review plus read-only reviewer pass completed in this checkpoint.
  handoff: Integrate with work packets and maintenance audit.
- owner: templates-worker
  scope: `docs/templates/*_PACKET.md`
  status: Done
  objective: Create reusable role-specific packet templates.
  verification: Lead review plus checker alignment completed in this checkpoint.
  handoff: Integrate with work packet checker docs.
- owner: slack-surface-explorer
  scope: read-only `apps/slack-gateway/src/listeners/mentions.ts`; `apps/slack-gateway/src/listeners/actions.ts`; `apps/slack-gateway/src/blocks/taskCards.ts`
  status: Done
  objective: Map Slack listener and card changes for CFO-0004.
  verification: Read-only file inspection and handoff report.
  handoff: Identified stale approval, command-like follow-up, and update-PR boundary risks.
- owner: orchestrator-explorer
  scope: read-only `apps/orchestrator/src/tasks.ts`; `apps/orchestrator/src/context.ts`; `packages/shared/src/prompts.ts`; `packages/shared/src/types.ts`; `tests/orchestrator-flow.test.ts`
  status: Done
  objective: Map domain/test changes for CFO-0004.
  verification: Read-only file inspection and handoff report.
  handoff: Recommended approval-gated test runs, approval supersession, and deterministic coverage.
- owner: pr-runner-explorer
  scope: read-only `apps/local-runner/src/pullRequest.ts`; `tests/pull-request.test.ts`
  status: Done
  objective: Map local Git/GitHub lifecycle changes for CFO-0005.
  verification: Read-only file inspection and handoff report.
  handoff: Recommended create/update/no-op lifecycle semantics, PR metadata validation, and deterministic `gh` fake tests.
- owner: slack-pr-explorer
  scope: read-only `apps/orchestrator/src/tasks.ts`; `apps/slack-gateway/src/listeners/actions.ts`; `apps/slack-gateway/src/blocks/taskCards.ts`; `packages/shared/src/types.ts`; `tests/orchestrator-flow.test.ts`
  status: Done
  objective: Map Slack/orchestrator changes for CFO-0005.
  verification: Read-only file inspection and handoff report.
  handoff: Recommended channel-aware orchestrator authorization, PR status action, lifecycle cards, and duplicate/no-auth tests.
- owner: queue-persistence-explorer
  scope: read-only queue/persistence design for CFO-0006
  status: Done
  objective: Evaluate the durable queue boundary and storage options before implementation.
  verification: Read-only handoff report.
  handoff: Recommended additive queue/lease tables, SQLite atomic claim semantics, and keeping JSON single-process only.
- owner: queue-daemon-explorer
  scope: read-only queue/daemon design for CFO-0006
  status: Done
  objective: Evaluate worker daemon responsibilities and queue acceptance risks.
  verification: Read-only handoff report.
  handoff: Recommended store-backed claim operations, explicit recovery tests, and a future direct/queued gateway execution mode.
- owner: queue-daemon-reviewer
  scope: read-only CFO-0006 implementation review
  status: Done
  objective: Find queue/daemon correctness, status, and audit issues before checkpoint.
  verification: `npm run typecheck`; `npm test -- --test-reporter=spec tests/queue.test.ts tests/daemon.test.ts`
  handoff: Found stale lease mutation, missing queued-plan approval creation, and retried-session idle state. Lead fixed all three and added regression tests.
- owner: runner-hardening-explorer
  scope: read-only `apps/local-runner/src/startupChecks.ts`; `apps/orchestrator/src/runner/ExecAdapter.ts`; `apps/local-runner/src/daemon.ts`; `infra/codex`; config/docs/tests
  status: Done
  objective: Evaluate CFO-0007 runner hardening acceptance and implementation risks.
  verification: Read-only handoff report.
  handoff: Recommended four runner profiles, startup posture checks, complete env allowlist enforcement, deterministic config/env/policy tests, and avoiding credential-bearing env inheritance.
- owner: runner-hardening-reviewer
  scope: read-only CFO-0007 security review
  status: Done
  objective: Check profile binding, policy validation, execpolicy posture, and env filtering before checkpoint.
  verification: Read-only implementation review.
  handoff: Initial review found advisory-only profiles, heuristic policy scanning, and warning-only execpolicy validation. Lead fixed all three; re-review reported no remaining blockers.
- owner: packaging-ops-reviewer
  scope: read-only CFO-0008 setup validator and operations docs review
  status: Done
  objective: Check setup diagnostics for secret/path leakage and live-credential requirements.
  verification: Read-only review.
  handoff: Reviewer reported no blockers.
- owner: audit-viewer-security-reviewer
  scope: read-only CFO-0011 audit viewer auth and docs review
  status: Done
  objective: Check auth bypass, remote-bind defaults, secret/path leakage, localhost compatibility, and test coverage.
  verification: Read-only review plus final re-review after fixes.
  handoff: Initial review found dashboard path disclosure and missing remote-bind coverage; re-review found unauthenticated local error disclosure; final re-review reported no blockers.
- owner: pr-ready-reviewer
  scope: read-only CFO-0012 ready-for-review PR handoff review
  status: Done
  objective: Check authorization, idempotency, origin/branch validation, Slack UI exposure, persistence consistency, tests, and docs.
  verification: Read-only implementation review.
  handoff: Reviewer found status-sync and duplicate-click UX issues; both were fixed before checkpoint. No auth bypass or origin/branch validation hole was found.
- owner: ci-detail-explorer
  scope: read-only `packages/shared/src/types.ts`; `apps/local-runner/src/pullRequest.ts`; `apps/orchestrator/src/tasks.ts`; `apps/slack-gateway/src/blocks/taskCards.ts`; PR status tests and docs
  status: Done
  objective: Identify the smallest safe compact CI detail model before CFO-0013 implementation.
  verification: Read-only implementation checklist and edge-case report.
  handoff: Recommended normalized check items, defensive rollup parsing, capped Slack rendering, and compact count-only audit metadata.
- owner: lead
  scope: `packages/shared/src/types.ts`; `apps/orchestrator/src/persistence`; `apps/local-runner/src/daemon.ts`; `apps/slack-gateway/src`; queue/daemon/gateway tests; operations docs
  status: Done
  objective: Add durable Slack progress notifications for queued runner jobs without making runner daemons own Slack I/O.
  verification: `npm run check`
  handoff: Implemented durable notification records, daemon emission, gateway delivery, retry/error handling, SQLite atomic claims, JSON compatibility, docs, and tests. Remaining gap: convert Slack mention/action execution to enqueue queued work by default.
- owner: lead
  scope: `apps/local-runner/src/git.ts`; `apps/local-runner/src/pullRequest.ts`; PR handoff tests; operations/security docs
  status: Done
  objective: Add worktree/branch divergence guardrails for draft PR handoff.
  verification: `npm run check`
  handoff: Implemented detached HEAD, wrong branch, pre-staged index, behind-upstream, and unsafe clean-recovery guardrails. Remaining gap: runner cleanup and artifact retention policy.
- owner: lead
  scope: `apps/orchestrator/src/artifacts.ts`; `apps/orchestrator/src/tasks.ts`; cleanup/retention tests; operations/security docs
  status: Done
  objective: Define and enforce conservative runner cleanup and local artifact retention policy.
  verification: `npm run check`
  handoff: Cleanup now skips active runs, queued jobs, pending approvals, completed sessions without draft PR metadata, and dirty worktrees. Diff artifacts are bounded, ephemeral, and excluded from durable patch-body persistence. Remaining gap: release-readiness review.
- owner: lead
  scope: `docs/ROADMAP.md`; `docs/DECISIONS.md`; `docs/SECURITY.md`; `docs/work-packets/0020-email-control-plane-roadmap.yaml`
  status: Done
  objective: Roadmap email via local IMAP/SMTP bridge patterns as a future local-first control-plane adapter.
  verification: `npm run check:work-packets`; `npm run typecheck`; `git diff --check`
  handoff: Email is recorded as a post-v0.1.0 adapter path that reuses the orchestrator, queue, audit, and runner boundaries. No credentials or runtime email implementation were touched.
- owner: lead
  scope: release-readiness gate automation; `docs/RELEASE_READINESS.md`; release docs; runbook/changelog/roadmap updates
  status: Done
  objective: Make v0.1.0 release-readiness checks repeatable and document remaining manual gates.
  verification: `npm run check`
  handoff: Added `npm run check:release`, included it in the full gate, fixed a runbook Markdown fence defect, and documented that v0.1.0 still needs a live Slack smoke test plus maintainer tag approval.
- owner: lead
  scope: Slack mention intent classifier; live-smoke blocker regression
  status: Done
  objective: Fix repo-qualified new task mentions that include words like "stop".
  verification: focused context regression test; `npm run typecheck`; `npm run build`; `npm run check:work-packets`
  handoff: No-session `repo:<id>` mentions now start new tasks before cancel-word handling; existing-session `stop` still cancels.
- owner: lead
  scope: live Slack release smoke; test repo; release-readiness notes; npm audit lockfile update
  status: Done
  objective: Verify the final live Slack plan/approve/execute/PR path before v0.1.0 tag decision.
  verification: live Slack mention, planning, approval, workspace-write execution, draft PR creation, `npm audit fix`, `npm run check`
  handoff: Smoke passed against a disposable test repository and created a draft PR; strict-mode allowlists remain a pre-normal-use configuration step.
- owner: lead
  scope: release-prep closeout; changelog; release readiness; live config validator
  status: Done
  objective: Finalize tracked v0.1.0 materials and add secret-safe strict-mode config validation before maintainer tag approval.
  verification: `npm run validate:live-config`; focused validator/release tests; `npm run check`
  handoff: Release materials are dated and checked; the protected local `.env` still needs explicit strict-mode Slack allowlist values before normal live use; tag remains maintainer-gated.
- owner: lead
  scope: non-live release code audit; tests; obvious bug/hardening review
  status: Done
  objective: Run broad non-live verification and inspect code before v0.1.0 approval.
  verification: `npm run check`; focused Slack/orchestrator/PR regression suite; targeted code review
  handoff: Fixed stale approval supersession, Slack mrkdwn escaping, token-shaped notification redaction, and PR body code-span escaping. Live validation was intentionally excluded at operator request; `.env` was not edited or printed.
- owner: lead
  scope: relay-started local Codex session handoff; Slack completion summaries; continuation from Slack
  status: Done
  objective: Let a local Codex run started through Relay notify Slack on completion and continue from the bound Slack thread.
  verification: focused local-session tests; `npm run check`
  handoff: Added `/codex handoff`, `npm run local:session`, queued runner execution, Slack summary cards, and follow-up resume coverage. Arbitrary attach to pre-existing terminal Codex sessions remains deferred pending a provenance design.
- owner: lead
  scope: orchestration tracking policy documentation in Codex Relay and reusable scaffold
  status: Done
  objective: Make tracked governance artifacts and untracked runtime/scratch artifacts explicit in the right docs.
  verification: `npm run check:work-packets`; `npm run typecheck`; external scaffold `npm run check`; generated-scaffold smoke check
  handoff: Codex Relay policy lives in `docs/TASK_MANAGEMENT.md` with pointers from orchestration and documentation guides. The reusable scaffold tracks the same policy in its own documentation.
- owner: lead
  scope: v0.1.0 release candidate and public-release docs polish
  status: Done
  objective: Make the release candidate clear for public release and unblock `v0.1.0` publication.
  verification: `npm run check`; `npm run validate:live-config`; `git diff --check`
  handoff: Release candidate commit is `a20830b`; tracked gate passed. Local `.env` live validation still fails closed on placeholder/missing strict-mode values and remains an operator action.
- owner: lead
  scope: public artifact hygiene across release docs, task/audit docs, selected historical work packets, and public test fixtures
  status: Done
  objective: Remove local paths, private project references, informal notes, and unnecessary live-smoke identifiers before public release.
  verification: targeted public-hygiene scan; git history hygiene scan; `npm run check`; `git diff --cached --check`
  handoff: Current tracked tree is sanitized for targeted public-risk strings. The repository was rebuilt from a fresh public root commit before publication.
- owner: lead
  scope: Slack follow-up intent routing for diff-aware draft PR requests
  status: Done
  objective: Ship v0.1.1 so "create/draft PR" thread replies use deterministic PR handoff and clean worktrees return a diff summary.
  verification: focused context/orchestrator tests; live Slack smoke workflow; `npm run check`
  handoff: Patch committed as `15fddbe`; live smoke created draft PR #3 directly from the follow-up without a second plan card. Release publication remains the final step.

## Done

- Slack Socket Mode gateway.
- Thread mention plan flow.
- Message shortcut plan flow.
- JSON-backed sessions, runs, and approvals.
- Worktree isolation.
- Approval-gated implementation.
- Real cancellation.
- Diff summary modal.
- Draft PR creation from completed worktree branches.
- Draft PR updates from completed follow-up work and compact PR status summaries from Slack.
- Fake-runner integration test harness.
- Operational startup checks.
- Durable queued-run Slack progress notifications.
- `/codex new` modal support.
- App Home pending approvals and recent session details.
- Follow-up Codex exec resume for existing Slack threads.
- Safe stale worktree cleanup.
- Starter skills/plugin packaging.
- Starter security/runbook docs.
- Real Slack workspace smoke test against `codex-relay-test-repo`.
- Codex CLI argument compatibility regression tests.
- Draft PR title/body sanitizer for Codex markdown summaries.
- Draft PR metadata persistence on sessions, including duplicate create protection.
- Full-build roadmap with acceptance criteria.
- SQLite-backed persistence with JSON migration path.
- Public security policy, threat model, and local secret scanner.
- Repo governance docs, release process, documentation guide, and GitHub templates.
- Ignored `brand-candidates/` workflow for unapproved ASCII/SVG/logo exploration.
- GitHub remote initialized for `josephbartlett/codex-relay`.
- SemVer metadata, MIT license, CODEOWNERS, editor settings, Node version, and CI check workflow.
- Strict Slack authorization policy for users, channels, repo-specific access, maintainer role, and denied-path tests.
- Public agent/subagent orchestration guide, delegation packet, handoff template, and agent-ready issue template.
- Structured audit events, `/codex audit`, App Home audit summaries, and local read-only audit viewer.
- Custody-First Orchestration pattern spec, machine-readable work packets, strict packet checker, maintenance audit, case study, and reusable packet templates.
- Explicit Slack thread follow-up intent handling for continue, revise plan, run tests, summarize diff, update PR, cancel, and unsupported intents.
- CFO-0005 GitHub draft PR lifecycle: create/update/no-op PR actions, PR status summaries, origin validation, and retry recovery.
- CFO-0006 durable queue and runner leases: queue jobs, SQLite atomic claims, worker daemon, heartbeat/retry/recovery behavior, queued-plan approval creation, and queue audit events.
- CFO-0007 runner hardening: relay runner profiles, startup policy posture checks, required execpolicy validation, filtered child-process environment, and security-review-backed tests.
- CFO-0008 packaging and operations: Slack-less setup validator, Docker/local service examples, SQLite backup/restore notes, and release checklist updates.
- CFO-0011 authenticated audit viewer: fail-closed remote bind opt-in, Basic Auth for dashboard/events, safe health checks, path redaction, generic error responses, setup validation, and security-review-backed tests.
- CFO-0012 PR ready-for-review handoff: authorized Slack action and follow-up intent, `gh pr ready` runner helper, origin/branch/open-state validation, idempotent duplicate behavior, status-to-local-ready sync, and regression tests.
- CFO-0013 compact PR check detail: normalized GitHub check/status rollups, capped Slack check detail, count-only audit metadata, parser compatibility and Slack-link safety regressions.
- CFO-0010 Custody-First scaffold dry run: generic scaffold created outside this repo, clean install/check verified, no Codex Relay-specific leakage found, and publication decisions remained maintainer-gated.
- CFO-0014 Custody-First scaffold hardening: added JSON Schema, schema consistency checks, leakage scanning, init/close helpers, neutral examples, and review notes to the external scaffold. Clean scaffold install/check, smoke init/check, close-helper smoke, inside-target rejection, Relay packet checker, and Relay typecheck all passed.
- CFO-0015 External scaffold repository bootstrap: initialized the external scaffold as a GitHub-backed repo, added MIT/governance/CI/release hygiene and a visual asset review gate, pushed `main`, and kept branch protection, release tagging, and npm publication maintainer-gated.
- CFO-0016 Codex Relay maintenance refocus: tabled external scaffold work, made Custody-First packet usage explicit in `AGENTS.md`, tightened visual asset approval rules, and reset the active build order to Codex Relay product hardening.

## Deferred

- `SdkAdapter`.
- `AppServerAdapter`.
- Multi-runner queue/orchestrator split.
- Containerized runner isolation.
- Public Slack Marketplace distribution.
