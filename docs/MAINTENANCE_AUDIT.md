# Maintenance Audit

This file records repo-maintenance custody events that are useful to humans but do not belong in product runtime audit state.

Product audit answers: what did Codex Relay do from Slack?

Maintenance audit answers: how did the repository itself change, who owned the packet, what was checked, and which commit closed it?

## Event Shape

Maintenance audit entries should include:

- packet ID
- owner
- status transition
- review or verification evidence
- commit SHA when the packet is done
- notes about risks, deferrals, or maintainer approval requirements

The machine-readable source of truth is `docs/work-packets/*.yaml`. This file is the narrative rollup.

## 2026-04-17

### CFO-0049: Publish v0.2.1 Slack UX Patch Release

- owner: lead
- status: done
- verification: `npm run check:work-packets`, `npm run typecheck`, `npm run build`, `npm test`, `npm run check`, `git diff --check`, targeted public-risk string scan
- commit: local release metadata checkpoint artifact
- notes: Prepared local `v0.2.1` package metadata, changelog, release-readiness notes, task tracker updates, and work-packet closure for Slack UX action-refresh fixes and live validation evidence. Historical `v0.2.0` release evidence remains separate from the `v0.2.1` patch validation. Push, tag, and GitHub release publication remain maintainer-gated.

### CFO-0048: Slack Live UX Validation

- owner: lead
- status: done
- verification: `npm run check:work-packets`, `npm run typecheck`, `npm run build`, `npm test`, `npm run check`, `git diff --check`, targeted public-risk string scan
- commit: local validation checkpoint artifact
- notes: Live Slack validation passed for slash status/new, App Home approval, original thread approval-card refresh after App Home approval, isolated implementation, source-repo cleanliness, Create PR, PR status, and Ready for review against a disposable repo. The live pass found and fixed the stale thread approval-card surface; focused regression coverage now verifies the original thread approval card is replaced after acceptance. No Slack IDs, PR URLs, tokens, private repo paths, local machine details, or live task content were recorded.

### CFO-0047: Slack UX Hardening Sweep

- owner: lead
- status: done
- verification: `npm run check:work-packets`, `npm run typecheck`, `npm run build`, `npm test`, `npm run check`, `git diff --check`, targeted public-risk string scan
- commit: local checkpoint artifact
- notes: Tightened existing Slack UX without changing the safety model. Added deterministic slash command smoke coverage, exported and tested App Home/status rendering, expired stale App Home approvals before display, avoided premature Open Details buttons on kickoff cards, improved no-session and stale-approval copy, and guarded concurrent draft PR handoffs. Public docs were swept for stale direct-workspace wording, missing ready-for-review references, over-broad smoke claims, and local/private details. Live slash/App Home/PR lifecycle mutation smokes remain operator-gated local checks because they require workspace app configuration and disposable PR state.

### CFO-0046: Publish v0.2.0 Control-Plane Release

- owner: lead
- status: done
- verification: `npm run check:work-packets`, `npm run typecheck`, `npm run build`, `npm test`, `npm run check`, `git diff --check`, targeted public-risk string scan
- commit: release metadata checkpoint artifact
- notes: Prepared v0.2.0 release metadata after explicit maintainer approval to push, tag, and publish. Release notes lead with user-visible Slack ask, email SMTP/IMAP, reply continuation, direct workspace gating, and Slack/email hardening. Gmail-specific live validation and email-originated write approvals remain future work.

### CFO-0045: Slack Control-Plane Live Validation

- owner: lead
- status: done
- verification: `npm run check:work-packets`, focused Slack/control-plane regression suite, `npm run typecheck`, `npm run build`, `npm test`, `npm run check`, `git diff --check`, redacted Slack bot auth check, redacted Socket Mode app-token check, temporary strict-deny gateway startup, local runner startup, manual Slack ask, manual threaded ask, and manual plan/approval/worktree execution completed
- commit: `1160007`
- notes: Slack bot and Socket Mode credentials validate from WSL, gateway and runner startup posture passed under temporary strict deny-all policy, and automated Slack/control-plane coverage is passing. Manual live Slack smoke validated ask, threaded ask continuation, approval creation, approval execution, worktree isolation, and source-repo cleanliness against a disposable repo. The live pass found runner-authored local path leakage in Slack plan text and a details-action session lookup gap; patched live smoke then validated local-path redaction, approval execution through a single gateway/runner pair, and working diff summary modal behavior. The Slack smoke helper now loads local environment values so future local smoke runs match the runbook.

### CFO-0042: Email Control-Plane Live Validation

- owner: lead
- status: done
- verification: `npm run typecheck`, `npm run build`, `npm run validate:live-config`, `npm run email:test`, `npm run email:poll`, `npm run check:work-packets`, `npm run check`, redacted SMTP/IMAP live validation
- commit: redacted evidence accepted for v0.2.0
- notes: SMTP, IMAP ask, reply continuation, and local handoff summary validation succeeded through a local mailbox bridge with redacted reporting. Direct workspace intake reached the runner against a disposable repo, but local Windows Codex write sandbox rejected writes and the source repo remained unchanged. Email-originated write approvals remain deferred.

### CFO-0044: Email Live-Validation Hardening And Local Smoke Automation

- owner: lead
- status: done
- verification: `npm run check:work-packets`, `npm run typecheck`, `npm run build`, `npm test`, `npm run check`, `git diff --check`, local WSL Codex sandbox preflight skip, and redacted Windows Codex sandbox preflight completed
- commit: `e012114`
- notes: Local bridge SMTP and IMAP validation continued with redacted reporting. Live ask intake, reply continuation, and local-session email summary paths succeeded. Email direct workspace intake reached the runner against a disposable repo, but Windows Codex reported write-sandbox denial and no source edit occurred. Parser hardening now ignores Relay-generated status mail unless an explicit user command is present. Local Slack smoke automation remains local-config only; no Slack IDs, token values, email addresses, provider endpoint details, or local private paths were recorded. CFO-0042 accepted the redacted evidence for v0.2.0 while deferring the remaining Windows Codex write-sandbox blocker.

## 2026-04-13

### CFO-0001: Establish Codex Relay Foundation

- owner: lead
- status: done
- verification: `npm run check`
- commit: `6a192d5`
- notes: Initial project foundation, Slack gateway, worktree runner, persistence, PR creation, docs, release hygiene, and security baseline.

### CFO-0002: Add Authorization, Product Audit, And Agent Orchestration Foundation

- owner: lead
- reviewer: read-only subagent reviewer
- status: done
- verification: `npm run check`
- commit: `09d1060`
- notes: Added strict Slack authorization, structured product audit events, local audit viewer, and first agent orchestration guide. Reviewer found repo-policy precedence ambiguity before commit; fixed and covered by tests.

### CFO-0003: Formalize Custody-First Orchestration

- owner: lead
- workers: pattern/case-study docs worker; role-template docs worker
- reviewer: read-only subagent reviewer
- status: done
- verification: `npm run check:work-packets`, `npm run check`
- commit: `65e3d08`
- notes: Added the public pattern spec, case study, machine-readable work packets, stricter checker, maintenance audit, role templates, and generic YAML seed. Reviewer found that the first checker did not enforce enough of the custody trail; the final checker now requires objective, non-goals, handoff expectations, verification evidence, reviewer, checks, date, and commit closure for done packets.

### CFO-0004: Add Follow-Up Thread Intent Handling

- owner: lead
- explorers: Slack-surface read-only explorer; orchestrator/test read-only explorer
- reviewer: read-only subagent reviewer
- status: done
- verification: `npm run check`
- commit: `68400e0`
- notes: This packet validated the Custody-First process through feature work. The split exposed two useful issues before implementation: stale approvals after plan revision and command-like follow-ups being treated as new plans. The reviewer then found owner-gate and stale-approval ordering bugs, plus Slack approval-copy and test-run completion issues. Fixes and regression tests were added before the feature checkpoint.

### CFO-0005: Complete GitHub Draft PR Lifecycle

- owner: lead
- explorers: PR-runner read-only explorer; Slack/orchestrator read-only explorer
- reviewer: read-only subagent reviewer
- status: done
- verification: `npm run check`
- commit: `dcfe2bc`
- notes: The split validated the create/update/no-op lifecycle before implementation. The runner now updates existing PRs only after validating PR URL, branch metadata, and origin repo match; Slack exposes Update PR and PR status controls; and the orchestrator stores compact PR status audit events without raw GitHub payloads. Reviewer findings around push/edit retry recovery and PR URL origin validation were fixed before checkpoint.

### CFO-0006: Add Durable Queue And Runner Leases

- owner: lead
- explorers: queue/persistence read-only explorer; queue/daemon read-only explorer
- reviewer: read-only subagent reviewer
- status: done
- verification: `npm run typecheck`, `node --import tsx --test tests/daemon.test.ts tests/queue.test.ts`, `npm run check`
- commit: `f34d587`
- notes: Added durable queue jobs, runner leases, SQLite atomic claim behavior, worker daemon entry point, queue audit events, queued-plan approval creation, and retry/recovery tests. Reviewer found stale lease mutation, missing queued-plan approvals, and retried-session idle state before checkpoint; all were fixed and covered by regression tests. Lead review also changed SQLite load normalization from full-store flush to row-level upserts to avoid clobbering concurrent queue state.

### CFO-0007: Harden Runner Execution Policy

- owner: lead
- explorer/reviewer: read-only runner-hardening reviewer
- status: done
- verification: `npm run typecheck`, `node --import tsx --test tests/runner-hardening.test.ts tests/codex-exec-args.test.ts`, `npm run check`
- commit: `40478cd`
- notes: Added named relay runner profiles, runtime profile binding in `codex exec` args, inline safe profile config, startup posture checks for profiles/rules/network, required execpolicy validation by default, and child-process environment filtering. Security review initially found advisory-only profiles, heuristic policy scanning, and warning-only execpolicy validation; all were fixed before checkpoint and re-review reported no remaining blockers.

### CFO-0008: Add Packaging And Operations Validator

- owner: lead
- reviewer: read-only diagnostics-safety reviewer
- status: done
- verification: `npm run validate:setup`, `node --import tsx --test tests/setup-validator.test.ts`, `npm run check`
- commit: `87b9a1d`
- notes: Added Slack-less setup validation, safe diagnostics tests, Docker runner and compose examples, SQLite backup/restore notes, and release checklist updates. Reviewer confirmed no blockers for secret/path leakage or live-credential requirements.

### CFO-0011: Add Authenticated Audit Viewer Mode

- owner: lead
- reviewer: read-only audit-viewer security reviewer
- status: done
- verification: `npm run typecheck`, `node --import tsx --test tests/audit-viewer.test.ts`, `npm run check`
- commit: `2e269a8`
- notes: Added fail-closed remote bind opt-in, Basic Auth for dashboard/events, public `ok`-only health checks, setup validation, docs, and audit viewer regression tests. Reviewer found dashboard path disclosure, missing remote-bind coverage, and unauthenticated local error disclosure before checkpoint; all were fixed and final re-review reported no blockers.

### CFO-0012: Add PR Ready-For-Review Handoff

- owner: lead
- reviewer: read-only PR-ready reviewer
- status: done
- verification: `npm run typecheck`, `node --import tsx --test tests/pull-request.test.ts tests/orchestrator-flow.test.ts`, `npm run check`
- commit: `1145c08`
- notes: Added an authorized Slack button and thread follow-up intent for marking existing draft PRs ready, backed by `gh pr ready`, branch/origin/open-state validation, idempotent already-ready behavior, and local ready metadata sync from live PR status. Reviewer found status-sync and duplicate-click UX issues before checkpoint; both were fixed before commit.

### CFO-0013: Add Compact PR Check Detail

- owner: lead
- explorer: read-only CI-detail explorer
- reviewer: read-only compact-check-detail reviewer
- status: done
- verification: `npm run typecheck`, `node --import tsx --test tests/pull-request.test.ts tests/orchestrator-flow.test.ts`, `npm run check`
- commit: `14e4113`
- notes: Added normalized check/status rollup parsing, capped Slack check detail, Slack-link URL hardening, and count-only audit boundary tests. Reviewer found nested rollup double-counting and Slack control-character URL risks before checkpoint; both were fixed with regression coverage before commit.

### CFO-0010: Extract Custody-First Orchestration Scaffold

- owner: lead
- reviewer: read-only scaffold extraction reviewer
- status: done
- verification: external scaffold clean install/check, `npm run check:work-packets`, `npm run typecheck`
- commit: `797e244`
- notes: Created a dry-run generic scaffold outside this repo with a README, AGENTS guide, pattern spec, templates, sample packet, checker, package metadata, and extraction notes. Reviewer found no Codex Relay-specific leakage; clean scaffold install/check was rerun before closure. Publication, license, and repository setup decisions remained maintainer-gated.

### CFO-0014: Harden Custody-First Scaffold For Publication Review

- owner: lead
- reviewer: read-only scaffold publication reviewer
- status: done
- verification: external scaffold clean install/check, generated-scaffold smoke check, close-helper smoke workflow with `--allow-unverified-artifact`, inside-target rejection check, `npm run check:work-packets`, `npm run typecheck`
- commit: `45277cd`
- notes: Added JSON Schema, schema consistency checks, leakage scanning, scaffold initialization helper, packet closure helper, neutral feature/security/release examples, and a review checklist to the external scaffold. Reviewer found helper hardening issues before checkpoint; fixes were applied and the scaffold was verified from a clean install and smoke copy. Release and publication choices remained maintainer-gated.

### CFO-0015: Bootstrap External Custody-First Repository

- owner: lead
- reviewer: read-only publication-prep reviewer
- status: done
- verification: external `npm ci && npm run check && npm test`, external publish guard rejection, external initializer smoke check, external inside-target rejection check, `npm run check:work-packets`, `npm run typecheck`
- commit: external scaffold checkpoint `cee4c4f`
- notes: Initialized the external scaffold repository, pushed `main`, added MIT/governance/CI/release hygiene, added a visual asset review gate after rendered-review quality issues, and kept branch protection, release tagging, and npm publication maintainer-gated.

### CFO-0016: Refocus Codex Relay Maintenance

- owner: lead
- reviewer: lead
- status: review
- verification: `npm run check:work-packets`, `npm run typecheck`
- commit: `da1946e`
- notes: Table external scaffold work and reset the active build order to Codex Relay product hardening. AGENTS and orchestration docs now require Custody-First packets for non-trivial repo work.

### CFO-0017: Add Queued Slack Progress Delivery

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`
- commit: `2450c92`
- notes: Added durable Slack notification records for queued runner lifecycle events, JSON/SQLite persistence, SQLite atomic notification claiming, gateway delivery polling, sanitized retry/error handling, tests, and operations/security/decision docs. Roadmap now includes a future email control-plane path using local bridge-style transport.

### CFO-0018: Add PR Worktree Branch Guardrails

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`
- commit: `582e9fd`
- notes: Added branch/upstream helpers and draft PR handoff checks for detached HEAD, wrong branch, pre-staged index state, behind-upstream branches, and clean recovery commits that are not present on upstream. Regression coverage was added for each new guardrail while preserving pushed-update recovery after `gh pr edit` failures.

### CFO-0019: Add Runner Cleanup And Retention Policy

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`
- commit: `b7d9ca5`
- notes: Added explicit cleanup policy reporting, conservative cleanup eligibility, queued-job and pending-approval skip checks, no-PR completed-session protection, dirty-worktree preservation, and bounded ephemeral diff artifact metadata. Regression coverage confirms dry-run behavior, active/queued/pending/no-PR skips, clean removal, dirty preservation, and retention caps.

### CFO-0020: Roadmap Email Control Plane

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check:work-packets`, `npm run typecheck`, `git diff --check`
- commit: `df3adb0`
- notes: Added a post-v0.1.0 future path for email as a local-first control-plane adapter, with local mail-bridge workflows recorded as future integration references. Decision and security docs now require an ADR/security review before email-originated write approvals. No email credentials or runtime email implementation were touched.

### CFO-0021: Add Release Readiness Gate

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`
- commit: `056a541`
- notes: Added `npm run check:release`, included it in the full check gate, added a release-readiness test, fixed a runbook Markdown fence defect, and documented the remaining manual gates in `docs/RELEASE_READINESS.md`. Automated readiness is passing; `v0.1.0` still requires live Slack smoke testing and explicit maintainer tag approval.

### CFO-0023: Fix Repo-Qualified Mention Start Intent

- owner: lead
- reviewer: lead
- status: done
- verification: `node --import tsx --test --test-reporter=spec tests/context.test.ts`, `npm run typecheck`, `npm run build`, `npm run check:work-packets`
- commit: `115aeb4`
- notes: The first live smoke mention included "then stop", which was interpreted as cancel before new-task classification. No-session mentions with explicit `repo:<id>` now classify as new tasks before cancel-word handling; existing-session `stop` still cancels.

### CFO-0022: Live v0.1.0 Slack Smoke Test

- owner: lead
- reviewer: lead
- status: done
- verification: live Slack mention, plan, approval, workspace-write execution, draft PR creation, `npm audit fix`, `npm run check`
- commit: `fb93072`
- notes: Live smoke passed against a disposable test repository. The smoke changed only `RELEASE_SMOKE.md` and created a draft PR. Strict mode correctly failed closed until the smoke gateway was temporarily restarted with process-level `CODEX_POLICY_MODE=local-dev`; `.env` was not edited. The temporary gateway was stopped after the smoke. A moderate `follow-redirects` npm advisory surfaced during closure and was fixed with `npm audit fix`.

### CFO-0024: v0.1.0 Release Prep Closeout

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run validate:live-config`, `npm run check`
- commit: `f5212eb`
- notes: Finalized the dated `v0.1.0` changelog entry, added the secret-safe live `.env` posture validator, recorded GitHub repository posture, and reran the full release gate. The validator correctly reports that the protected local `.env` is missing strict-mode Slack user/channel/repo allowlists; `.env` was not edited or printed.

### CFO-0025: Release Code Audit And Non-Live Verification

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`, focused Slack/orchestrator/PR regression suite, targeted code review
- commit: `65ec8d9`
- notes: Broad non-live release audit completed at operator request with live `.env` validation intentionally excluded. Review found and fixed stale approval supersession ordering, Slack mrkdwn rendering of untrusted runner/config/session text, broader token-shaped Slack notification error redaction, and PR body changed-file code-span escaping. `.env` was not edited or printed.

### CFO-0026: Relay-Started Local Session Handoff

- owner: lead
- reviewer: lead
- status: done
- verification: focused local-session and notification regressions, `npm run typecheck`, `npm run check`, `git diff --check`
- commit: `e0c8073`
- notes: Added the Relay-started local handoff path so a local command creates a Slack-bound session, queues runner execution in an isolated worktree, stores the Codex session id on completion, posts continuation-oriented Slack summaries, and allows Slack thread follow-up to resume the saved Codex session. This does not change the external scaffold; that repository remains tabled unless a future packet changes reusable schema/checker/template behavior.

### CFO-0027: Document Orchestration Tracking Policy

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check:work-packets`, `npm run typecheck`, `git diff --check`, external scaffold `npm run check`, generated-scaffold smoke check
- commit: `8db5821`
- notes: Made the tracked-versus-untracked orchestration policy explicit in `docs/TASK_MANAGEMENT.md`, linked it from orchestration and documentation guides, and verified the reusable scaffold now has its own inherited tracking policy. The policy is to track governance/audit artifacts while keeping runtime state, raw transcripts, prompt dumps, worktrees, logs, secrets, and unapproved candidates out of git.

## 2026-04-15

### CFO-0039: Email Control Plane Foundation

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`; `git diff --check`; targeted public-risk string scan
- artifact: included in email feature checkpoint commit
- notes: Added disabled-by-default generic email control-plane config, fail-closed sender authorization, read-only plain-text command parsing, and regression tests. The foundation intentionally does not include live mailbox polling, SMTP replies, provider-specific setup, or email-originated write approvals.

### CFO-0038: Publish v0.1.4 Documentation Hygiene Patch

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`; `git diff --check`; targeted public-risk string scan
- commit: `1dee71c`
- notes: Prepared the patch release for public documentation hygiene updates. Release publication proceeded under maintainer authorization.

### CFO-0037: Public Language Sanitization Follow-Up

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`; `npm run typecheck`; `git diff --check`; targeted public-risk string scan
- commit: `d25ad04`
- notes: Sanitized public maintenance and release-history wording while preserving the intentional `AGENTS.md` publication-approval guardrails. The targeted public-risk scan returned only those intentional `AGENTS.md` guardrail matches.

### CFO-0029: Public Artifact Hygiene Audit

- owner: lead
- reviewer: lead
- status: done
- verification: targeted public-hygiene scan, git history hygiene scan, `npm run check`, `git diff --cached --check`
- commit: `97cb4e1`
- notes: Removed tracked internal notes and extraction-detail docs, sanitized local path/non-public project/live-smoke identifiers from current public docs and tests, and kept only intentional public ownership metadata. Current tracked tree is clean for the targeted public-risk strings. The repository was rebuilt from a fresh public root commit before publication.

### CFO-0030: Fix Slack Follow-Up PR Intent Routing

- owner: lead
- reviewer: lead
- status: done
- verification: focused context/orchestrator regressions, live Slack smoke workflow, `npm run check`
- commit: `15fddbe`
- notes: Live wrapper smoke testing showed that a compound "continue by checking diff, then create a draft PR if changed" reply was treated as a generic continuation plan. The patch routes create/draft PR language to deterministic PR handoff and returns a diff summary instead of attempting PR creation when the worktree is clean. The v0.1.1 live smoke created draft PR #3 directly from the follow-up without posting a second plan card.

### CFO-0031: Public Documentation Posture Follow-Up

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`
- commit: `a252bec`
- notes: Post-public sanity audit found stale top-level security and release-readiness wording from the earlier `v0.1.0` preparation phase. Updated the public security policy, release readiness status, README current-scope wording, changelog, and release-readiness checker language.

### CFO-0032: Public Repository Publish Approval Policy

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`
- commit: `339161a`
- notes: Documented that local commits are allowed verified checkpoints, while direct pushes to `main`, tags, GitHub releases, and repository-setting changes require explicit maintainer approval for the specific operation. The `v0.1.2` release actions completed after maintainer approval.

### CFO-0033: Link Custody-First Reusable Scaffold

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check:work-packets`; `npm run typecheck`
- commit: `e05c279`
- notes: Added public documentation linking Codex Relay's Custody-First Orchestration practice to the reusable standalone scaffold repository. This is a local checkpoint until maintainer approval to push.

### CFO-0034: Public Documentation Polish Audit

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check:work-packets`; `npm run typecheck`; `git diff --check`; targeted public-risk string scan
- commit: `1a0594b`
- notes: Neutralized legacy maintenance wording around non-public preparation while preserving the audit record. Targeted scans found no personal email or first-collaborator language in tracked public files.

### CFO-0035: Link Official Codex CLI Upstream

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check:work-packets`; `npm run typecheck`; `git diff --check`
- commit: `5f4c039`
- notes: Added a minimal operator-facing link to OpenAI's official Codex CLI docs so users can find installation, authentication, and option details without implying official endorsement.

### CFO-0036: Publish v0.1.3 Documentation Patch

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`; `git diff --check`; targeted public-risk string scan
- commit: `1a8ba87`
- notes: Prepared the patch release that publishes the public documentation polish, reusable Custody-First scaffold reference, and official Codex CLI documentation link. Release actions completed after maintainer approval.

### CFO-0040: Email SMTP Notification Adapter

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`; `git diff --check`; targeted public-risk string scan
- artifact: included in feature checkpoint commit
- notes: Added disabled-by-default SMTP lifecycle notifications for queued runner plan-ready, completed, and failed states. The work added a durable email notification outbox for JSON and SQLite stores, a generic SMTP publisher daemon, local smoke command, provider setup docs, and regression coverage while keeping inbound polling and email-originated approvals out of scope.

### CFO-0041: Email IMAP Read-Only Intake

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`; `npm run check:audit`; `npm run check:secrets`; `git diff --check`; targeted public-risk string scan
- artifact: included in feature checkpoint commit
- notes: Added disabled-by-default IMAP polling, durable inbound message dedupe, read-only email-originated session/task creation, compact email acknowledgements, and provider-neutral IMAP docs. A full check run reached release readiness with 120 tests passing; the first `npm audit` request hit transient registry DNS `EAI_AGAIN`, then `npm run check:audit` was rerun successfully with 0 vulnerabilities. Email-originated write approvals remain out of scope.

## 2026-04-16

### CFO-0043: v0.2.0 Lightweight Ask And Direct Workspace Modes

- owner: lead
- reviewer: lead
- status: done
- verification: `npm run check`; `git diff --check`; targeted public-risk string scan
- artifact: local v0.2.0 feature checkpoint; no push, tag, or release
- notes: Added Slack and email ask/query mode, reply-to-email continuation using `relay:<sessionId>` routing hints, and explicitly gated direct workspace quick mode. Review found and fixed a Slack ask-mode workspace custody bug before checkpoint: ask follow-ups now preserve existing worktree sessions instead of converting them to source workspace sessions. CFO-0042 remains active for live Proton Bridge validation only.
