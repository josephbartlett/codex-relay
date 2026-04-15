# Runbook

## Local Startup

```bash
npm install
cp .env.example .env
npm run validate:setup
npm run dev:slack
```

## Slack App Setup

1. Create a Slack app from `infra/slack/app-manifest.yaml`.
2. Enable Socket Mode.
3. Create an app-level token with Socket Mode permissions.
4. Install the app to the workspace.
5. Invite the bot to a channel.
6. Set `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `.env`.

## Repo Binding

Use absolute paths:

```text
CODEX_ALLOWED_REPOS=api=/srv/repos/api,web=/srv/repos/web
CODEX_DEFAULT_REPO_ID=api
CODEX_STORE_KIND=sqlite
CODEX_DATABASE_PATH=.codex-slack/state.db
CODEX_STATE_PATH=.codex-slack/state.json
CODEX_PROFILES_PATH=infra/codex/profiles.toml
CODEX_RULES_PATH=infra/codex/default.rules
CODEX_REQUIRE_EXECPOLICY_CHECK=true
CODEX_RUNNER_ENV_ALLOWLIST=PATH,HOME,USER,USERNAME,SHELL,TMPDIR,TMP,TEMP,LANG,LC_ALL,TERM,NO_COLOR,CODEX_HOME
```

Tasks can override the default repo with `repo:<id>`.

Follow-up mentions in an existing task thread reuse the saved Codex exec session when available and continue in the same session worktree.

Use lightweight ask mode for read-only questions that do not need the plan/approval/worktree/PR loop:

```text
@codexbot ask repo:api which file produces Table 3?
@codexbot query repo:api what matching covariates are used in 004?
```

Ask mode returns an answer in the thread and does not create an approval, diff card, or PR controls.

Direct workspace quick mode is available only when explicitly enabled for trusted solo repos:

```text
CODEX_DIRECT_WORKSPACE_ENABLED=true
CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS=api
CODEX_DIRECT_WORKSPACE_REQUIRE_CLEAN=true
```

Then use an explicit quick/direct request:

```text
@codexbot quick repo:api update RELEASE_SMOKE.md with one passing sentence
```

This edits the configured source repo path instead of an isolated worktree. It is useful for small trusted edits, but it bypasses the default PR handoff flow and should stay repo-scoped.

## Slack Authorization Policy

Strict policy is the default:

```text
CODEX_POLICY_MODE=strict
CODEX_ALLOWED_SLACK_USERS=U1234567890
CODEX_ALLOWED_SLACK_CHANNELS=C1234567890
CODEX_REPO_ALLOWED_SLACK_USERS=api=U1234567890|U2345678901
CODEX_REPO_ALLOWED_SLACK_CHANNELS=api=C1234567890
CODEX_MAINTAINER_SLACK_USERS=U9999999999
```

Repo policy entries use `repo=id1|id2`. Separate multiple repos with commas, semicolons, or newlines.

Strict semantics:

- A selected repo must have repo-specific user and channel policy.
- Global allowlists, when populated, are outer boundaries.
- Repo-specific allowlists narrow access for that repo.
- Maintainers bypass task ownership and user allowlists, but not channel or repo policy.
- `/codex new` and message shortcuts perform a coarse modal-open check first, then validate the selected repo before a Codex run starts.

For an isolated local smoke test, you may temporarily set:

```text
CODEX_POLICY_MODE=local-dev
```

Do not use `local-dev` for shared Slack workspaces or machines with sensitive repos.

## Message Shortcut

Use "Run with Codex" from a Slack message action menu. The modal asks for a repo id and task text, keeps the selected message text as context, and starts the plan phase in that message's thread.

## Slash Command

Use `/codex new` for a top-level task. The modal asks for repo id and task text, posts a kickoff message to the channel, and uses that message as the session thread. Use `/codex status` for a compact list of recent in-memory sessions.

## App Home

The Home tab shows pending approvals, recent sessions, and recent audit events visible to the current Slack user. Approvals from App Home execute against the original task thread and post progress/completion messages there.

## Audit Layer

Codex Relay records structured audit events for authorization denials, plan starts/completions, approval creation/acceptance, execution start/completion/failure, cancellation, cleanup, diff access, draft PR creation/update, and PR status checks.

Slack surfaces:

- `/codex audit` shows recent audit events visible to your Slack user.
- `/codex audit --limit=25` raises the ephemeral result limit up to 50.
- App Home includes a compact recent audit section.

Local read-only viewer:

```bash
npm run dev:audit
```

By default the viewer binds to `127.0.0.1:1787` and reads the configured JSON or SQLite state path. It does not require Slack credentials and should stay on localhost unless it is placed behind real authentication.

Optional settings:

```text
AUDIT_VIEWER_HOST=127.0.0.1
AUDIT_VIEWER_PORT=1787
AUDIT_VIEWER_ALLOW_REMOTE=false
AUDIT_VIEWER_REQUIRE_AUTH=false
AUDIT_VIEWER_USERNAME=codex-relay
AUDIT_VIEWER_PASSWORD=
```

Remote operator access is fail-closed. If `AUDIT_VIEWER_HOST` is anything other than a loopback host, startup requires both:

```text
AUDIT_VIEWER_ALLOW_REMOTE=true
AUDIT_VIEWER_PASSWORD=<long-random-password>
```

`AUDIT_VIEWER_REQUIRE_AUTH=true` can also force Basic Auth on localhost. The `/healthz` endpoint remains unauthenticated for local process supervision, while the dashboard and `/events.json` are protected when auth is enabled.

Do not expose the audit viewer directly to the public internet. Use TLS, firewall rules or a private network, and a reverse proxy if it leaves localhost. Audit events intentionally avoid raw prompts, command output, diffs, and Slack thread text, but they can still contain repo IDs, actor IDs, session IDs, PR URLs, and lifecycle summaries.

## Local Runner Daemon

The direct Slack gateway remains the default solo-local path. CFO-0006 adds the durable queue bridge used by future team-mode deployments and by tests:

```bash
npm run dev:runner
```

The runner daemon:

- loads the configured JSON or SQLite state store without requiring Slack tokens;
- claims available queue jobs with a runner lease;
- heartbeats the lease while a runner task is active;
- completes, retries, or fails the queue job when the runner exits;
- creates the normal pending approval when a queued read-only plan completes;
- creates compact Slack notification records for major queued-run lifecycle changes;
- writes compact queue audit events without raw prompts, command output, or diffs.

Use SQLite for any multi-process queue work:

```text
CODEX_STORE_KIND=sqlite
CODEX_DATABASE_PATH=.codex-slack/state.db
```

JSON mode stores queue jobs for local compatibility, but it does not provide cross-process locking. Do not use JSON mode for multiple worker processes.

## Local Session Handoff

Use `npm run local:session` when you are at the local machine, want to start work through Codex Relay, and want Slack to receive the completion summary so you can continue from mobile later.

The command creates or reuses a Slack-bound session, creates an isolated worktree, enqueues runner work, and exits. It does not call Slack directly. The local runner daemon executes the queue job, and the Slack gateway delivers durable notifications from the shared store.

Use SQLite mode for this workflow:

```text
CODEX_STORE_KIND=sqlite
CODEX_DATABASE_PATH=.codex-slack/state.db
```

Terminal 1:

```bash
npm run dev:slack
```

Terminal 2 or service manager:

```bash
npm run dev:runner
```

Start a local handoff session:

```text
/codex handoff repo:api
```

The Slack command posts a handoff thread and privately returns a command with the correct `--thread-key` and `--user` values. Then run the local command from the Codex Relay repo:

```bash
npm run local:session -- --thread-key T123:C123:1776000000.000000 --user U123 --repo api --mode implement --prompt "continue the parser fix and summarize when done"
```

Equivalent split Slack thread fields are also accepted:

```bash
npm run local:session -- --team T123 --channel C123 --thread 1776000000.000000 --user U123 --repo api --mode plan --prompt "inspect the failing auth tests"
```

Modes:

- `plan`: read-only, creates the normal approval card when the queued plan completes.
- `implement`: workspace-write in the session worktree, started by explicit local operator command.
- `test`: workspace-write test/check run in the session worktree.

When the queued run finishes, the Slack thread receives a compact summary card with "Show diff summary" and, when appropriate, PR actions. Reply in that same thread and mention Codex Relay to continue; follow-up planning reuses the saved Codex session id when the runner reported one.

This is not arbitrary attach to any already-running terminal Codex process. Relay-started handoff is the supported safe boundary because the harness owns the Slack thread binding, worktree path, queue job, audit trail, and Codex session id.

## Queued Slack Progress Delivery

Queued runners do not call Slack directly. They write compact `slack_notifications` records into the configured store. The Slack gateway polls those records, claims each notification with a short delivery lease, posts the corresponding thread message, and marks the notification `sent`.

Notification delivery is intentionally coarse:

- runner claimed a queued job;
- queued plan completed and created an approval;
- queued implementation/test work completed;
- queued work failed after retry handling.

The delivery records store Slack thread IDs, session/run/approval/job IDs, title, compact detail text, status, attempts, lease metadata, and sanitized delivery errors. They do not store raw prompts, raw command output, full diffs, Slack tokens, or runner logs.

Use SQLite mode whenever the gateway and runner daemon are separate processes. SQLite notification claims use an immediate transaction so competing gateway processes do not deliver the same pending notification. JSON mode persists notifications for solo compatibility only.

## Email Gateway

Email support is optional and disabled by default. It is useful when a queued runner finishes while the operator is away from Slack, or when email is the preferred local-first command surface for self-hosted operation.

Start with the generic guides:

```text
docs/email/SMTP.md
docs/email/IMAP.md
```

Provider notes live under `docs/email/`. Keep provider-specific hosts, usernames, sender addresses, recipients, token labels, and generated secrets in local `.env` only.

After configuring SMTP values locally, validate outbound delivery:

```bash
npm run email:test
```

For read-only inbound email commands, configure `EMAIL_CONTROL_PLANE_ENABLED=true`, `EMAIL_ALLOWED_SENDERS`, and `EMAIL_IMAP_*` values in `.env`. Send plain-text commands such as:

```text
repo:api inspect the failing parser tests and propose a plan
```

Run the email gateway and runner against the same state backend:

```bash
npm run dev:email
npm run dev:runner
```

For a one-shot inbound smoke test after sending an allowlisted plain-text command email:

```bash
npm run email:poll
```

For compiled operation:

```bash
npm run build
npm run start:email
npm run start:runner
```

The email gateway claims durable email notification records, sends compact text summaries, polls IMAP when enabled, converts allowlisted plain-text commands into queued tasks, and records success/failure in the local audit log.

It does not send raw command output, include full diffs, ingest attachments, store raw email source, or accept approvals by email.

Email command examples:

```text
repo:api inspect the failing parser tests and propose a plan
ask repo:api which file produces Table 3?
query repo:api what changed in the latest run?
```

Outbound plan-ready and completion emails include a `relay:<sessionId>` reference. Reply to that email with a follow-up such as:

```text
ask which files did you inspect?
continue by checking the current diff and proposing the next step
```

Replies with `ask` or `query` queue read-only answer runs. Replies without those prefixes queue a read-only plan in the same Relay session. Plain-text email replies cannot approve write execution.

Email direct workspace mode has a separate gate on top of `CODEX_DIRECT_WORKSPACE_ENABLED`:

```text
EMAIL_DIRECT_WORKSPACE_ENABLED=true
```

When both direct workspace gates are enabled, new email commands with `quick` or `direct` can edit the source working tree for allowlisted repos. Direct email commands cannot continue an isolated worktree session; use a new email with `repo:<id> direct ...` for that path.

## Setup Validator

Run this after `npm install` and before connecting a live Slack workspace:

```bash
npm run validate:setup
```

The validator checks Node, required npm scripts, `.env.example` coverage, runner env allowlist safety, Codex profile/rules files, Docker example files, and basic local command availability. It does not read or print `.env`, does not require real Slack tokens, and treats optional Codex/GitHub CLI availability as warnings when a live task is not being run.

For Codex CLI installation, authentication, and option details, use OpenAI's official Codex CLI docs: https://developers.openai.com/codex/cli.

## Operational Checks

- `npm run validate:setup`
- `npm run typecheck`
- `npm run build`
- `codex login status`
- `git -C <repo> status --short`
- `codex exec --json --cd <repo> --sandbox read-only "summarize this repo"`

At gateway startup, the app checks:

- `git --version`
- `codex login status`
- configured repos are git repositories
- worktree root is writable
- state path directory is writable
- configured Codex runner profiles exist and do not use `danger-full-access`
- configured profiles do not enable network access by default
- configured execpolicy rules include guards for recursive deletes, git remote mutation, network tools, and destructive Docker cleanup
- `codex execpolicy check` can parse the configured rules file; set `CODEX_REQUIRE_EXECPOLICY_CHECK=false` only for known-compatible Codex versions that do not expose that check command
- `gh auth status` as a warning-only check for PR creation

## Runner Hardening

Codex Relay ships four starter runner profiles in `infra/codex/profiles.toml`:

- `codex_relay_readonly`: read-only plan/review/explain posture.
- `codex_relay_write`: workspace-write implementation/test posture.
- `codex_relay_pr`: workspace-write PR preparation posture.
- `codex_relay_cleanup`: read-only cleanup inspection posture.

The harness passes both `--profile` and explicit `--sandbox` arguments to `codex exec`. It also supplies inline profile config overrides for the selected runner profile so the runtime invocation and the checked profile posture stay aligned. `infra/codex/default.rules` is the starter execpolicy file. Install or copy both files into your managed Codex configuration path as appropriate, then point `CODEX_PROFILES_PATH` and `CODEX_RULES_PATH` at the files you actually want the gateway to validate.

Codex child processes inherit only names listed in `CODEX_RUNNER_ENV_ALLOWLIST`. The default deliberately omits Slack, GitHub, OpenAI, cloud-provider, and SSH-agent credentials. Add credentials only for a repo-specific need, and prefer short-lived credentials.

## State File

The gateway supports two storage modes:

- `CODEX_STORE_KIND=json` writes sessions, task runs, approvals, audit events, and queue jobs to `CODEX_STATE_PATH`.
- `CODEX_STORE_KIND=sqlite` writes durable state, including queue jobs, Slack notification delivery records, and leases, to `CODEX_DATABASE_PATH` and migrates from `CODEX_STATE_PATH` when the SQLite database is empty.

Active child processes are not resumable after a restart; any run that was `running` is marked failed on load, while pending approvals and queued queue jobs remain available until handled or expired by their own lifecycle.

Queue lease recovery is explicit. A worker claim sets a lease with an expiry. If that lease expires, later heartbeat/complete/fail calls from the stale worker are rejected. `DurableQueue.recoverAbandonedLeases` requeues the job until `maxAttempts` is reached, then marks it failed. SQLite claims use an immediate transaction so competing workers cannot claim the same queued job.

## SQLite Backup And Restore

Stop the Slack gateway and runner processes before filesystem-level backup or restore.

Backup:

```bash
sqlite3 .codex-slack/state.db ".backup '.codex-slack/state.backup.db'"
cp .codex-slack/state.db .codex-slack/state.copy.db
```

Prefer the `sqlite3 .backup` form when the CLI is installed because it is safe for SQLite databases. The copy command is acceptable only after all Codex Relay processes are stopped.

Restore:

```bash
cp .codex-slack/state.db .codex-slack/state.before-restore.db
cp .codex-slack/state.backup.db .codex-slack/state.db
npm run validate:setup
```

Keep backups in encrypted storage. State can contain Slack user IDs, repo IDs, task summaries, PR URLs, queue IDs, and audit metadata.

## Docker And Local Service Examples

`infra/docker/runner.Dockerfile` and `infra/docker/docker-compose.example.yml` are starter examples for self-hosted deployments. They are not a complete team-runner isolation design.

Before using Docker against real repositories:

- install or mount an authenticated Codex CLI configuration according to your policy;
- mount only approved repo roots;
- keep `.codex-slack` on durable storage;
- use SQLite mode for gateway plus runner processes;
- keep `CODEX_RUNNER_ENV_ALLOWLIST` narrow.

For local service managers, run the gateway and runner as separate processes:

```bash
npm run start:slack
npm run start:runner
```

Use your service manager's secret store for `.env` values rather than committing or baking them into images.

Draft PR metadata is stored on the session after PR creation. If the user clicks "Create PR" again after restart and no new worktree changes exist, the harness returns the stored PR instead of creating a second commit and PR.

## Cancellation

Cancel buttons resolve the Codex session from the Slack thread, stop active local child processes, reject pending approvals, and mark the session cancelled. Only the user who started the task can cancel it.

## Diff Summary

The completion card's "Show diff summary" button opens a modal with changed files, diff stat, name-status output, and a truncated patch preview from the task worktree. Only the user who started the task can open the modal.

## Draft PR Lifecycle

The completion card's "Create PR" button commits all current worktree changes, pushes the session branch to `origin`, and opens a draft PR with `gh pr create --draft`. Requirements:

- `gh` is installed and authenticated.
- the source repository has an `origin` remote with push access.
- the worktree is on the session branch.
- the worktree is not detached.
- the worktree index has no pre-staged changes before handoff.
- the session branch is not behind its upstream tracking branch.
- the session status is `done`.
- the requester is the task owner.

If the worktree has no changes or contains unmerged paths, PR creation fails without pushing.

If a previous PR update committed and pushed successfully but `gh pr edit` failed, a retry can recover only when the local HEAD is already present on the branch upstream. If the branch has no upstream or local HEAD is not on upstream, Codex Relay stops before updating PR metadata so it does not describe commits that were never pushed.

After successful creation, the PR URL and metadata are persisted on the session and shown in App Home recent sessions.

After a draft PR exists, completion cards show "Update PR", "PR status", "Ready for review", and "Open PR". "Update PR" reuses the stored PR URL. If the worktree has new user-facing changes, Codex Relay commits them to the same session branch, pushes, and updates the existing draft PR title/body with `gh pr edit`. If no new user-facing changes exist, the operation is reported as already current and does not call GitHub. Existing PR metadata must match the session branch and contain an https pull request URL before the runner will commit or push. Existing PR URLs must also match the worktree's GitHub origin remote.

"PR status" uses `gh pr view` to fetch compact state, draft, mergeability, branch, status-check counts, and a capped normalized list of check names/states/links for Slack. It does not ingest raw CI logs, annotations, artifacts, or full GitHub check payloads. Product audit stores counts only.

"Ready for review" uses `gh pr ready` after validating the session owner or maintainer, session branch, PR URL, GitHub origin, and current PR state. Duplicate clicks are idempotent: an already-ready PR reports that state instead of attempting another publication transition. This action changes public GitHub PR state but does not merge or enable auto-merge.

## Worktree Cleanup

Use `/codex cleanup` to list stale task worktrees older than 7 days that belong to you. This is a dry run by default.

Use `/codex cleanup --older-than-days=3` to change the age threshold.

Use `/codex cleanup --confirm` to remove eligible worktrees. Cleanup uses `git worktree remove` without force, so dirty worktrees are skipped rather than deleted.

Cleanup eligibility is conservative:

- the session must belong to the requester;
- the session must be older than the requested threshold;
- the session status must be `done`, `failed`, or `cancelled`;
- active in-process runs, queued/leased runner jobs, and pending approvals are skipped;
- completed `done` sessions require draft PR metadata before cleanup;
- dirty or invalid worktrees are skipped by Git because Codex Relay does not use forced removal.

Diff details shown in Slack are generated on demand from the worktree. Codex Relay treats these as ephemeral artifacts: it caps changed-file lists, diff stats, name-status output, and patch previews before rendering, and it does not persist patch bodies or raw command output in the state store.

## Cleanup

Worktrees live under `CODEX_WORKTREE_ROOT`. Remove completed task worktrees with:

```bash
git -C <source-repo> worktree remove <worktree-path>
```
