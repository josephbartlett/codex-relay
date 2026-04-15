# ADR 0002: Draft PR Lifecycle From Session Worktree

## Status

Accepted.

## Context

The Slack harness needs a complete useful loop after implementation: get the code into a reviewable GitHub PR without requiring the user to return to a laptop.

## Decision

The MVP `Create PR` button:

1. Verifies the requester owns the Slack task.
2. Collects current worktree changes.
3. Fails if no changes exist or the worktree has unmerged/conflicted paths.
4. Stages all worktree changes.
5. Creates one commit.
6. Pushes the session branch to `origin`.
7. Opens a draft PR using `gh pr create --draft`.

After a PR exists, the same session uses an update path:

1. Verifies the requester owns the Slack task or is an authorized maintainer.
2. Validates stored PR metadata has an https pull request URL and matches the session branch.
3. Returns unchanged metadata when no new user-facing worktree changes exist.
4. Fails if the worktree has unmerged/conflicted paths.
5. Commits new user-facing worktree changes.
6. Pushes the same session branch to `origin`.
7. Updates the existing PR with `gh pr edit`.

The `PR status` action reads compact PR state, status-check counts, and bounded normalized check metadata with `gh pr view`; it does not ingest full CI logs, annotations, artifacts, or raw check payloads.

## Consequences

- The flow is immediately useful in solo local mode.
- The button is a clear approval boundary for publishing the branch.
- GitHub auth and repo remote setup are delegated to local `git` and `gh`.
- Duplicate PR actions are idempotent when no new user-facing changes exist.
- Corrupted PR metadata fails before commit or push.
- Team mode should add file allowlists and optional pre-PR approval cards.
