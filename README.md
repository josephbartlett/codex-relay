# Codex Relay

Slack is the control plane. Codex is the execution plane. Codex Relay lets a user start, approve, monitor, and hand off local or self-hosted Codex work from Slack without turning Slack into a terminal.

`v0.1.x` is the first local-first release line. It is intended for trusted operators who are comfortable running a local Slack Socket Mode app, a local Codex CLI, and one or more explicitly bound repositories.

## How It Works With Codex

Codex Relay does not replace Codex. It wraps local Codex execution with a safer remote-control layer:

1. Slack receives a mention, shortcut, slash command, approval click, or local handoff thread.
2. Codex Relay maps that Slack thread to a session, checks user/channel/repo authorization, and binds the task to a configured local repo.
3. Read-only planning runs through `codex exec --json`.
4. Approved or explicitly local-started write work runs in an isolated git worktree, not in your active branch.
5. Relay stores compact session, queue, approval, audit, and PR metadata locally.
6. Slack gets concise plan, approval, progress, completion, diff, and PR cards.
7. Follow-up mentions in the same thread continue the saved Codex session when Codex reports a resumable session id.

## Requirements

- Node.js 20 or newer.
- Git.
- Codex CLI available as `codex`.
- GitHub CLI available as `gh` for draft PR creation.
- A Slack workspace where you can install a Socket Mode app.
- At least one local git repository you are willing to bind explicitly in `.env`.

## Current Capabilities

1. Slack Socket Mode gateway with an `app_mention` listener.
2. Thread-to-session routing with JSON or SQLite-backed local state.
3. Read-only `codex exec --json` plan phase.
4. Slack approval button.
5. Approved `workspace-write` implementation phase in an isolated git worktree.
6. Message shortcut flow for turning an existing Slack message into a task.
7. Compact Slack status and completion cards.
8. Draft PR creation, update, compact check status, and ready-for-review handoff from completed session worktrees.
9. App Home visibility for approvals and recent sessions.
10. Structured audit events, `/codex audit`, and local read-only audit viewer.
11. Explicit Slack thread follow-up intents: continue, revise plan, run tests, summarize diff, update PR, and cancel.
12. Durable queue jobs, runner leases, and a local worker daemon API for the team-mode bridge.
13. Relay-started local session handoff for Slack completion summaries and remote continuation.
14. Runner hardening checks for shipped Codex profiles, execpolicy rules, and child-process environment filtering.
15. Secret scanning and release hygiene checks.

## Quick Start

```bash
npm install
cp .env.example .env
npm run check
npm run validate:setup
```

Create a Slack app from `infra/slack/app-manifest.yaml`, enable Socket Mode, install it to your workspace, invite the bot to a channel, and fill in `.env`.

Minimum local configuration:

| Key | Example value |
| --- | --- |
| `SLACK_BOT_TOKEN` | your bot token |
| `SLACK_APP_TOKEN` | your Socket Mode app token |
| `SLACK_SIGNING_SECRET` | your Slack signing secret |
| `CODEX_ALLOWED_REPOS` | `default=/absolute/path/to/a/git/repo` |
| `CODEX_DEFAULT_REPO_ID` | `default` |
| `CODEX_STORE_KIND` | `sqlite` |
| `CODEX_DATABASE_PATH` | `.codex-slack/state.db` |
| `CODEX_POLICY_MODE` | `strict` |
| `CODEX_ALLOWED_SLACK_USERS` | `U1234567890` |
| `CODEX_ALLOWED_SLACK_CHANNELS` | `C1234567890` |
| `CODEX_REPO_ALLOWED_SLACK_USERS` | `default=U1234567890` |
| `CODEX_REPO_ALLOWED_SLACK_CHANNELS` | `default=C1234567890` |

Then validate the live operator configuration without printing secret values:

```bash
npm run validate:live-config
```

Start the Slack gateway:

```bash
npm run dev:slack
```

In Slack:

```text
@codexbot repo:default inspect the repo and propose a safe first change
```

For a compiled run:

```bash
npm run build
npm run start:slack
```

For an experimental separate runner process against the configured durable store:

```bash
npm run dev:runner
```

To start local work through Relay and continue it later from Slack:

```text
/codex handoff repo:api
```

The Slack command posts a handoff thread and privately returns a local command with the correct thread key. Then run:

```bash
npm run local:session -- --thread-key T123:C123:1776000000.000000 --user U123 --repo api --mode implement --prompt "continue the parser fix and summarize when done"
```

Keep `npm run dev:runner` and `npm run dev:slack` running against the same SQLite store so the queued run executes and the Slack thread receives start/completion notifications. Follow-up mentions in that thread continue the saved Codex session when a session id is available.

To validate a fresh install without Slack tokens or a live Slack task:

```bash
npm run validate:setup
```

To validate a configured local `.env` for strict-mode live Slack operation without printing token values:

```bash
npm run validate:live-config
```

For the local read-only audit viewer:

```bash
npm run dev:audit
```

It binds to `127.0.0.1` without authentication by default. Remote binds require explicit opt-in plus Basic Auth:

```text
AUDIT_VIEWER_HOST=0.0.0.0
AUDIT_VIEWER_ALLOW_REMOTE=true
AUDIT_VIEWER_REQUIRE_AUTH=true
AUDIT_VIEWER_USERNAME=codex-relay
AUDIT_VIEWER_PASSWORD=<long-random-password>
```

Put remote audit access behind TLS and a trusted network boundary. The viewer is read-only, but audit events still contain repo IDs, Slack actor IDs, session IDs, PR URLs, and lifecycle summaries.

`CODEX_ALLOWED_REPOS` binds Slack tasks to local repositories:

```text
CODEX_ALLOWED_REPOS=api=/srv/repos/api,web=/srv/repos/web
CODEX_DEFAULT_REPO_ID=api
CODEX_STORE_KIND=sqlite
CODEX_DATABASE_PATH=.codex-slack/state.db
CODEX_RUNNER_ENV_ALLOWLIST=PATH,HOME,USER,USERNAME,SHELL,TMPDIR,TMP,TEMP,LANG,LC_ALL,TERM,NO_COLOR,CODEX_HOME
CODEX_PROFILES_PATH=infra/codex/profiles.toml
CODEX_RULES_PATH=infra/codex/default.rules
CODEX_REQUIRE_EXECPOLICY_CHECK=true
CODEX_POLICY_MODE=strict
CODEX_ALLOWED_SLACK_USERS=U1234567890
CODEX_ALLOWED_SLACK_CHANNELS=C1234567890
CODEX_REPO_ALLOWED_SLACK_USERS=api=U1234567890
CODEX_REPO_ALLOWED_SLACK_CHANNELS=api=C1234567890
```

In Slack:

```text
@codexbot repo:api inspect the failing auth tests and propose a fix
```

The bot posts a kickoff card, runs a read-only plan, then posts an approval card. Approved execution creates a worktree under `CODEX_WORKTREE_ROOT`. You can also use `/codex new` for a top-level task or the "Run with Codex" message shortcut; both open modals and create a Slack thread for the plan/approval loop.

In an existing Codex Relay thread, mention the bot with follow-up intents such as `continue`, `revise plan`, `run tests`, `summarize diff`, `update PR`, or `cancel`. Test runs are approval-gated because they execute repository code. After a draft PR exists, `update PR` commits any new session worktree changes to the same branch and updates the existing draft PR instead of creating a duplicate.

## Current Scope

This is an early local-first product. Runners are local, and the implemented runner is `ExecAdapter`. Follow-up tasks in the same Slack thread reuse the saved Codex exec session when available. The interfaces are already shaped so a later `SdkAdapter` or `AppServerAdapter` can replace subprocess orchestration without rewriting Slack listeners.

Team-mode queue primitives are present but still incremental: the gateway can keep using direct execution while durable queue jobs and the local worker daemon are used for the runner split. Queued runner lifecycle notifications are durable and deliverable through the Slack gateway. Converting all Slack mention/action execution to queue-by-default remains follow-on work.

Local session handoff is implemented for Relay-started sessions. Arbitrary attachment to an already-running terminal Codex process remains a follow-on because Relay needs a trustworthy Slack thread, worktree, and Codex session id to continue safely.

## Maintenance Pattern

Codex Relay uses Custody-First Orchestration for agent and subagent maintenance. This repository was the proving ground for the pattern: work is split into bounded packets, active scopes are checked for overlap, verification is recorded before closure, and maintenance history stays human-readable.

The standalone reusable scaffold lives at https://github.com/josephbartlett/custody-first-orchestration.

## Useful Files

- `apps/slack-gateway/src/listeners/mentions.ts` handles thread mentions.
- `apps/orchestrator/src/tasks.ts` owns the plan/execute workflow.
- `apps/orchestrator/src/persistence/jsonFileStore.ts` stores durable sessions, runs, and approvals.
- `apps/orchestrator/src/persistence/sqliteStore.ts` stores durable state in SQLite.
- `apps/orchestrator/src/queue.ts` owns queue job and lease transitions.
- `apps/orchestrator/src/runner/ExecAdapter.ts` wraps `codex exec --json`.
- `apps/local-runner/src/daemon.ts` claims queued runner work and maintains leases.
- `apps/local-runner/src/localSession.ts` creates Slack-bound local handoff sessions.
- `apps/local-runner/src/startupChecks.ts` validates startup dependencies and runner policy posture.
- `apps/local-runner/src/worktreeManager.ts` creates git worktrees.
- `infra/slack/app-manifest.yaml` contains the Slack app manifest.
- `infra/codex/default.rules` is the starter exec policy ruleset.
- `docs/ROADMAP.md` tracks the path from the current local-first release line to the fully built product.
- `docs/CUSTODY_FIRST_ORCHESTRATION.md` defines the multi-agent maintenance pattern used by this repo.
- `https://github.com/josephbartlett/custody-first-orchestration` contains the reusable Custody-First scaffold extracted from this work.
- `docs/work-packets/` contains machine-readable custody packets.
- `SECURITY.md` explains vulnerability reporting and security posture.

## Safety Defaults

- Plan/review/explain tasks use `read-only`.
- Approved implementation and explicit local handoff implementation use `workspace-write`.
- The harness never uses `danger-full-access` or `--yolo`.
- Network remains governed by the local Codex configuration and should stay disabled unless a repo profile explicitly permits it.
- Codex child processes receive only the configured `CODEX_RUNNER_ENV_ALLOWLIST` plus `NO_COLOR=1`; Slack, GitHub, OpenAI, and cloud provider tokens are not inherited by default.
- The audit viewer stays localhost-only unless `AUDIT_VIEWER_ALLOW_REMOTE=true` and `AUDIT_VIEWER_PASSWORD` are configured.

## Project Hygiene

```bash
npm run check
```

This runs typecheck, build, tests, and secret scanning.
It also validates setup, work packets, release readiness, and high-severity npm audit findings.

For setup-only validation:

```bash
npm run validate:setup
```

For packet-only validation:

```bash
npm run check:work-packets
```

For release-readiness validation:

```bash
npm run check:release
```

Use Conventional Commits and follow `CONTRIBUTING.md`. Release process and SemVer rules live in `docs/RELEASE_PROCESS.md`.
