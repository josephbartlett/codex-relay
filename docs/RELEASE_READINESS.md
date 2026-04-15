# Release Readiness

This document is the human-readable release gate for Codex Relay releases.

## Current Status

Status: `v0.1.0`, `v0.1.1`, and `v0.1.2` have been tagged and published. Local operator `.env` strict-mode posture may still need a protected-file update before normal live use on a new machine or workspace.

Reason: the automated local gate is repeatable, the live Slack smoke tests passed against the test repository, and changelog/release notes are published through `v0.1.2`. The local `.env` file remains protected by repo safety rules and must be updated explicitly for strict-mode normal operation if validation reports missing policy values.

## Automated Gates

Required before each release tag:

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

Required before each release tag:

- Run a live Slack task against a disposable or test repository. Status: passed for `v0.1.0` and `v0.1.1`.
- Approve an implementation and verify the write happens in the session worktree. Status: passed for `v0.1.0` and `v0.1.1`.
- Create or update a draft PR from the session branch. Status: passed for `v0.1.0` and `v0.1.1`.
- Verify compact PR status and ready-for-review behavior if a test PR is available. Status: covered by deterministic tests; live PR handoff was exercised during `v0.1.1`.
- Review `CHANGELOG.md` and convert the pending release section into a dated release entry.
- Confirm no unapproved `brand-candidates/` assets are tracked. Status: completed by release-readiness gate.
- Confirm `docs/TASKS.md` has no active release-blocking packet.
- Confirm GitHub branch protection and private vulnerability reporting settings are acceptable for the release.
- Configure strict-mode Slack user/channel/repo allowlists in `.env` for the live workspace. Status: `.env` remains protected; repo safety rules prevent automated `.env` edits without an explicit targeted operator request.

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

## v0.1.1 Live Smoke Result

Date: 2026-04-15

Repository: disposable test repository configured as `repo:default`

Result:

- Slack thread follow-up asked Relay to check the diff and create a draft PR if file changes existed.
- The follow-up routed to deterministic PR handoff instead of starting a generic Codex continuation plan.
- Draft PR creation succeeded against the test repository.
- The full local release gate passed after the fix.

## GitHub Repository Posture

Checked on 2026-04-15 with the authenticated GitHub CLI session:

- Repository: `josephbartlett/codex-relay`
- Visibility: public
- Default branch: `main`
- Issues: enabled
- Wiki: disabled
- Security policy: enabled at https://github.com/josephbartlett/codex-relay/security/policy
- Authenticated permission: admin
- Branch protection: not enabled at the time of the latest check. Enable branch protection for `main` once the first public-collaboration settings are finalized.

## Known Limitations

These are acceptable for the `v0.1.x` local-first release line if they remain documented:

- `ExecAdapter` is the only implemented runner adapter.
- Slack gateway direct execution remains the default solo-local path.
- Durable queue, runner leases, worker daemon, and queued Slack notifications exist, but Slack mention/action flows are not queue-by-default yet.
- The audit viewer is local/read-only and remote mode requires explicit operator hardening.
- Brand and diagram assets remain untracked until rendered screenshot review and maintainer approval.
- Email is roadmap-only and has no implementation in `v0.1.x`.
- `SdkAdapter`, `AppServerAdapter`, multi-runner pools, and container isolation are deferred.

## Tag Recommendation

Do not tag a release until:

- `npm run check` passes on a clean checkout;
- release notes are finalized;
- the human maintainer explicitly approves the tag.

Operator note: before normal post-release live use, run `npm run validate:live-config` and update the protected `.env` values if it reports missing strict-mode Slack policy.
