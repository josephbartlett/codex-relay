# v0.1.0 Release Readiness

This document is the human-readable release gate for the first public Codex Relay release.

## Current Status

Status: tracked release materials are ready for `v0.1.0` tagging and GitHub release publication. Local operator `.env` strict-mode posture may still need a protected-file update before normal live use.

Reason: the automated local gate is repeatable, the live Slack smoke test passed against the test repository, and the changelog/release notes are finalized for `v0.1.0`. The local `.env` file remains protected by repo safety rules and must be updated explicitly for strict-mode normal operation if validation reports missing policy values.

## Automated Gates

Required before tagging:

```bash
npm run check
```

`npm run check` includes:

- setup validation;
- TypeScript typecheck;
- build;
- test suite;
- work-packet validation;
- release-readiness validation;
- high-severity npm audit;
- local secret scan.

The release-specific gate is:

```bash
npm run check:release
```

It verifies required public files, package metadata, changelog/release doc sections, CI workflow posture, ignored runtime paths, tracked runtime-state hygiene, and Markdown fence balance.

The operator live-config gate is:

```bash
npm run validate:live-config
```

It reads the local `.env`, validates strict-mode Slack user/channel/repo policy, confirms repo bindings exist and are git worktrees, and does not print tokens, secrets, repo paths, or Slack IDs.

## Manual Gates

Required before tagging:

- Run a live Slack task against a disposable or test repository. Status: passed on 2026-04-13.
- Approve an implementation and verify the write happens in the session worktree. Status: passed on 2026-04-13.
- Create or update a draft PR from the session branch. Status: passed on 2026-04-13.
- Verify compact PR status and ready-for-review behavior if a test PR is available. Status: covered by deterministic tests; live PR was left open as a draft smoke artifact.
- Review `CHANGELOG.md` and convert `## [0.1.0] - Pending` into a dated release entry. Status: completed for 2026-04-15.
- Confirm no unapproved `brand-candidates/` assets are tracked. Status: completed by release-readiness gate.
- Confirm `docs/TASKS.md` has no active release-blocking packet. Status: current active packet is release publication only; close it before tagging.
- Confirm GitHub branch protection and private vulnerability reporting settings are acceptable for the first release. Status: repository is private at the time of release preparation, issues are enabled, wiki is disabled, top-level security policy is enabled, and current authenticated user has admin permission. Branch protection is not queryable while the repo is private under the current account/plan response; enable or re-check after making the repository public or changing the plan.
- Configure strict-mode Slack user/channel/repo allowlists in `.env` for the live workspace. Status: local `.env` currently does not pass `npm run validate:live-config`; repo safety rules prevent automated `.env` edits without an explicit targeted operator request.

## Live Smoke Result

Date: 2026-04-13

Repository: disposable test repository configured as `repo:default`

Result:

- Slack mention created a `repo:default` Codex session after CFO-0023 fixed repo-qualified start intent.
- Read-only plan completed and requested execution approval.
- Slack approval started the workspace-write implementation run.
- Implementation completed in an isolated session worktree.
- Worktree changed only `RELEASE_SMOKE.md`; `.codex` remained an untracked internal marker.
- Draft PR creation succeeded against the test repository.
- Security dependency check: `npm audit` initially reported a moderate `follow-redirects` advisory during closure; `npm audit fix` updated the lockfile to `follow-redirects@1.16.0` and cleared audit findings.

Notes:

- First retry correctly exposed strict-mode auth because no live Slack repo policy was configured. This is the intended fail-closed behavior.
- The gateway was temporarily restarted with process-level `CODEX_POLICY_MODE=local-dev` for the isolated smoke test; `.env` was not edited.
- The Slack Create PR button action did not arrive during the monitored window, so PR handoff was completed by invoking the same orchestrator PR lifecycle against the completed session. Earlier live testing already exercised Slack-triggered PR creation, and deterministic tests cover the action handler.

## GitHub Repository Posture

Checked on 2026-04-15 with the authenticated GitHub CLI session:

- Repository: `josephbartlett/codex-relay`
- Visibility: private
- Default branch: `main`
- Issues: enabled
- Wiki: disabled
- Security policy: enabled at https://github.com/josephbartlett/codex-relay/security/policy
- Authenticated permission: admin
- Branch protection: GitHub API returned that protection requires GitHub Pro or public repository visibility under the current account posture. Re-check and enable branch protection before or immediately after public visibility is turned on.

## Known Limitations

These are acceptable for `v0.1.0` if they remain documented:

- `ExecAdapter` is the only implemented runner adapter.
- Slack gateway direct execution remains the default solo-local path.
- Durable queue, runner leases, worker daemon, and queued Slack notifications exist, but Slack mention/action flows are not queue-by-default yet.
- The audit viewer is local/read-only and remote mode requires explicit operator hardening.
- Brand and diagram assets remain untracked until rendered screenshot review and maintainer approval.
- Email is roadmap-only and has no implementation in `v0.1.0`.
- `SdkAdapter`, `AppServerAdapter`, multi-runner pools, and container isolation are deferred.

## Tag Recommendation

Do not tag `v0.1.0` until:

- `npm run check` passes on a clean checkout;
- release notes are finalized;
- the human maintainer explicitly approves the tag.

Operator note: before normal post-release live use, run `npm run validate:live-config` and update the protected `.env` values if it reports missing strict-mode Slack policy.
