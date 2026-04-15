# Decision Log

## 2026-04-13: Slack Buttons Are Intentional Approval Boundaries

Buttons that mutate state are treated as explicit user approvals for their narrow action.

- `Approve execution` permits the approved plan to run in `workspace-write`.
- `Cancel` permits the harness to stop active child processes and reject pending approvals.
- `Create PR` permits the harness to commit current worktree changes, push the session branch, and open a draft PR.
- `Update PR` permits the harness to commit new session worktree changes, push the same branch, and update the existing draft PR.
- `PR status` permits a compact GitHub status lookup for the session PR.

Only the Slack user who started a task can use these actions in the MVP.

## 2026-04-13: Draft PR Flow Commits All Worktree Changes

The MVP creates PRs from isolated session worktrees. Because Codex writes happen only in that worktree after approval, the PR flow stages all current worktree changes and creates one commit before pushing.

This is pragmatic for solo/local mode. Team mode should add stricter checks, file allowlists, and optional human review of the file list before commit.

## 2026-04-13: Draft PR Metadata Belongs on the Session

After a draft PR is created, the session stores the PR URL, title, body, branch, commit, changed files, creator, and creation timestamp.

This makes restarts and duplicate Slack button clicks deterministic. GitHub remains the source of truth for the PR contents, but the harness needs a local pointer so App Home and thread actions do not attempt repeated commits or pushes.

## 2026-04-13: Draft PR Actions Are A Lifecycle

The Slack PR handoff is a create/update/no-op lifecycle, not a one-shot button.

- No stored PR metadata: commit current user-facing worktree changes, push the session branch, and create a draft PR.
- Stored PR metadata plus new user-facing changes: commit, push the same branch, and update the existing PR with `gh pr edit`.
- Stored PR metadata plus no user-facing changes: return the existing PR metadata unchanged.

Before any update commit or push, the local runner validates that stored PR metadata has an https pull request URL and matches the session branch. This prevents corrupted local state from updating the wrong PR.

## 2026-04-13: JSON Store Is Local-Mode Persistence Only

The JSON store makes local restarts survivable without adding a database. It is not intended for multi-runner team mode because there is no cross-process locking or concurrency control.

Team mode should use SQLite/Postgres and a queue.

## 2026-04-13: SQLite Is The Durable Local Store

SQLite is the durable store for the full local product and the stepping stone for team-mode queue tables. The implementation uses `better-sqlite3` rather than Node's experimental `node:sqlite` module so runtime behavior is stable on the current Node line.

JSON storage remains available as a compatibility fallback. When `CODEX_STORE_KIND=sqlite`, the gateway creates `CODEX_DATABASE_PATH` and migrates from `CODEX_STATE_PATH` if the database is empty.

## 2026-04-13: Security Is A Release Gate

`v0.1.0` must not ship without explicit security posture, threat model, secret scanning, authorization policy, and tests for denied actions.

This project controls local code execution from Slack, so security cannot be treated as optional hardening. Pull requests must describe security impact, and the local `npm run check` gate includes secret scanning.

## 2026-04-13: Brand Candidates Stay Untracked Until Approved

ASCII identity and brand guidelines can be tracked immediately, but generated SVG/logo/image candidates stay in ignored `brand-candidates/` until human review.

This keeps community-building work possible without accidentally publishing unreviewed, confusing, or legally risky imagery.

## 2026-04-13: Visual Assets Need Rendered Review

Visual assets cannot be approved from SVG/source inspection alone.

Generated diagrams, logos, screenshots, and brand imagery require rendered screenshot review at desktop and mobile or narrow viewport sizes. Review must check overlap, clipping, unintended symbols, label legibility, contrast, framing, and overall composition. Rejected assets stay untracked, and the gate must improve before more assets are promoted.

## 2026-04-13: Cleanup Is Dry-Run By Default

Worktree cleanup is destructive, so `/codex cleanup` only reports eligible worktrees. Actual removal requires `/codex cleanup --confirm`.

Cleanup is owner-scoped in the MVP and uses `git worktree remove` without force. Dirty or invalid worktrees are skipped.

Cleanup eligibility is conservative: sessions must be older than the requested threshold, must be `done`, `failed`, or `cancelled`, and must not have active runs, queued jobs, or pending approvals. Completed `done` sessions also require draft PR metadata before cleanup so finished work is not removed before PR handoff.

Diff summaries are treated as ephemeral local artifacts. The harness generates bounded changed-file, diff-stat, name-status, and patch-preview data on demand for Slack rendering, but does not persist patch bodies in the state store.

## 2026-04-13: Email Is A Future Control-Plane Adapter

Email belongs on the roadmap as another local-first control plane, not as a separate runner path. A future email adapter should translate allowlisted local mailbox events into the same sessions, task runs, approvals, queue jobs, and audit records that Slack uses today.

The runner side should remain unchanged. Local IMAP/SMTP bridge workflows are future integration references, but email support is not a `v0.1.0` release blocker.

Any future email implementation must treat sender identity as insufficient on its own for mutating approvals. The design needs mailbox/folder scoping, nonce-bound or signed approval replies, expiry, duplicate-message handling, and explicit raw-message retention policy before write actions are enabled.

## 2026-04-13: Delegated Work Must Be Disjoint And Verified

Subagents are allowed when a chunk can be owned independently, verified independently, and merged without file conflicts.

Parallel work must assign disjoint paths or concerns up front. If overlap is possible, the work is serialized. Every delegated chunk must end with a verification command, a touched-file summary, and a recorded handoff in `docs/TASKS.md`.

## 2026-04-13: Codex Relay Is The Active Product Focus

The extracted Custody-First Orchestration scaffold is tabled after private-repo bootstrap and visual gate hardening.

Future work returns to Codex Relay unless the external scaffold is explicitly reopened. External follow-ups such as branch protection, public visibility, release tagging, and npm publication remain maintainer-gated and are not part of the active Codex Relay build order.

## 2026-04-13: Strict Slack Authorization Is Fail-Closed

`CODEX_POLICY_MODE=strict` is the default. Repo-scoped actions require an explicit repo policy for the selected repo. Global Slack user and channel allowlists are outer boundaries when configured; repo-specific allowlists narrow access for that repo.

Maintainers bypass user ownership and user allowlists for operational actions, but they do not bypass channel or repo policy. This lets a maintainer approve or cancel a task without making every allowed channel valid for every repo.

Modal-open prechecks do not always know the final repo. They only verify that the user and channel are allowed by a global policy or by at least one repo policy. The final task start validates the selected repo before any Codex run starts.

## 2026-04-13: Agent Orchestration Is A Public Maintenance Surface

Multi-agent work is documented as a first-class maintenance workflow instead of an ad hoc local practice.

The repository now carries an orchestration guide, delegation packet template, handoff template, and GitHub issue template for agent-ready work. This keeps public contributors and coding agents on the same ownership, verification, and security model.

## 2026-04-13: Audit Is A Product Surface

Codex Relay records structured audit events in the same durable store as sessions, runs, approvals, and PR metadata.

The audit layer is intentionally human-readable and low-noise: it records lifecycle events, outcomes, actor IDs, repo/session/run IDs, approval IDs, changed-file counts, and PR URLs. It does not store raw prompts, complete Slack threads, command output, or patch bodies by default.

Slack gets lightweight audit access through `/codex audit` and App Home. Local operators get a read-only localhost audit viewer for richer filtering without exposing a remote admin UI in the MVP.

## 2026-04-13: Validate Custody-First Before Extracting It

Custody-First Orchestration should stay inside Codex Relay until it has been used through at least one more implementation packet after the pattern spec lands.

The generic scaffold is valuable, but extracting a separate repo too early would freeze assumptions before the checker, packet schema, templates, and maintenance audit have survived real feature work. The extraction target is tracked as a deferred work packet rather than a new folder or repository today.

## 2026-04-13: Follow-Up Tests Require Approval

Slack thread follow-ups are classified into explicit intents instead of being treated as generic new plans.

`summarize diff` is read-only and can run without approval. `cancel` is owner/maintainer-gated but does not need another approval. `continue`, `revise plan`, and `run tests` create read-only plans first.

Test execution remains approval-gated because tests run repository code and may write caches, snapshots, reports, or other artifacts. Revised plans and requested test plans reject older pending approvals before creating a replacement approval, so stale plans cannot be approved accidentally.

## 2026-04-13: Queue And Lease Semantics Are Additive First

The first durable queue implementation does not replace the direct Slack gateway execution path. It adds queue jobs, leases, heartbeat, retry, abandoned-lease recovery, and a local runner daemon as a bridge toward team-mode runners.

SQLite is the concurrency-capable local backend. Queue claims use an immediate transaction and enforce per-session and per-repo lease limits before a worker can claim work. JSON mode persists queue jobs for solo compatibility, but it remains single-process only because it has no cross-process lock.

Queued task runs remain queued across restart; only in-process `running` task runs are normalized to failed. This preserves durable queued work without pretending a killed child process can be resumed.

## 2026-04-13: Runner Children Do Not Inherit Full Process Environment

Codex runner child processes use `CODEX_RUNNER_ENV_ALLOWLIST` instead of inheriting `process.env`.

The default allowlist keeps basic shell/runtime variables and `CODEX_HOME`, but omits Slack, GitHub, OpenAI, cloud-provider, and SSH-agent credentials. This is intentionally stricter than many local CLI workflows. Repos that need credentials should use a narrower runner deployment or short-lived repo-specific credentials rather than expanding the global default.

## 2026-04-13: Remote Audit Viewer Access Is Opt-In

The audit viewer remains localhost-only and unauthenticated by default so local operators can inspect state without Slack credentials or extra setup.

If the viewer is bound to a non-loopback host, startup requires `AUDIT_VIEWER_ALLOW_REMOTE=true` and `AUDIT_VIEWER_PASSWORD`. Basic Auth protects the dashboard and `/events.json`; `/healthz` remains unauthenticated and returns only `ok` for process supervision.

This is intentionally a lightweight operator access layer, not a full team administration system. Remote deployments still need TLS, network controls, and password rotation.

## 2026-04-13: Ready-For-Review Is A PR State Transition

Marking a draft PR ready from Slack is treated as a publication-state change, not a passive status lookup.

The action requires the task owner or a maintainer, a completed session, existing PR metadata, matching session branch, matching GitHub origin, and an open PR. The local session records the last-known ready transition for Slack UI persistence, while GitHub remains the source of truth for current PR state.

Duplicate clicks are idempotent: if GitHub reports the PR is already ready, Codex Relay reports that state and keeps the local ready metadata instead of treating it as a failure.

## 2026-04-13: Queued Runners Publish Slack Progress Through Durable Notifications

Runner daemons do not own Slack API credentials or Slack delivery behavior. When a queued runner claims, completes, or fails work, it writes compact Slack notification records to the shared state store. The Slack gateway is the only process that claims those records and posts Slack messages.

This keeps the gateway as the control-plane boundary and the runner as the execution-plane boundary. Notification records are delivery state, not audit logs. They store thread/session/run/job IDs, a short title/detail, attempts, status, and sanitized delivery errors. They do not store raw prompts, command output, diffs, tokens, or logs.

SQLite is the multi-process backend for notification delivery. Slack notification claims use an immediate transaction so multiple gateway processes cannot intentionally deliver the same pending notification. JSON mode remains a solo compatibility path only.

## 2026-04-13: PR Handoff Requires Branch Custody Checks

Draft PR creation and update are publication actions. Before committing, pushing, editing PR metadata, or recovering a previous update, Codex Relay validates that the worktree is on the expected session branch, is not detached, has no pre-staged index state, and is not behind its upstream tracking branch.

Clean recovery after a failed `gh pr edit` is allowed only when the local HEAD is already present on the upstream branch. This preserves the useful retry path after a push succeeded but GitHub metadata editing failed, while blocking local-only commits from being described as if they were already on the PR branch.

## 2026-04-14: Local Handoff Requires Relay Custody

Remote continuation from a local Codex session is supported first for sessions started through Codex Relay.

That boundary is intentional. Relay-started local handoff creates the Slack thread binding, session record, isolated worktree, queue job, audit events, and runner notification state before Codex executes. When the runner reports a Codex session id, Slack follow-ups can resume that saved session safely from the same thread and worktree.

Arbitrary attachment to an already-running terminal process remains deferred. Without a trustworthy session id, workspace path, repo binding, Slack owner, and audit trail, the harness cannot prove that remote continuation is operating on the intended repo or branch.
