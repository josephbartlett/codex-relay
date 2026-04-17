# Release Readiness

This document is the human-readable release gate for Codex Relay releases.

## Current Status

Status: Release readiness materials are current through `v0.2.1`. Local operator `.env` strict-mode posture may still need protected-file updates before normal live use on a new machine or workspace.

Reason: the automated local gate is repeatable, Slack live smoke tests passed for ask, threaded ask, plan approval, worktree execution, and diff-summary viewing, and email live validation passed for generic SMTP/IMAP ask, reply continuation, and local handoff summary delivery. The local `.env` file remains protected by repo safety rules and must be updated explicitly for strict-mode normal operation if validation reports missing policy values.

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

- Run a live Slack task against a disposable or test repository. Status: passed for `v0.1.0`, `v0.1.1`, `v0.2.0`, and `v0.2.1`.
- Approve an implementation and verify the write happens in the session worktree. Status: passed for `v0.1.0`, `v0.1.1`, `v0.2.0`, and `v0.2.1`.
- Review `CHANGELOG.md` and convert the pending release section into a dated release entry.
- Confirm no unapproved `brand-candidates/` assets are tracked. Status: completed by release-readiness gate.
- Confirm `docs/TASKS.md` has no active release-blocking packet.
- Confirm GitHub branch protection and private vulnerability reporting settings are acceptable for the release.
- Configure strict-mode Slack user/channel/repo allowlists in `.env` for the live workspace. Status: `.env` remains protected; repo safety rules prevent automated `.env` edits without an explicit targeted operator request.

Required when PR lifecycle behavior changes:

- Create or update a draft PR from the session branch. Status: passed for `v0.1.0`, `v0.1.1`, and the `v0.2.1` Slack UX follow-up validation.
- Verify compact PR status and ready-for-review behavior if a test PR is available. Status: passed during the `v0.2.1` Slack UX follow-up validation against a disposable repo.

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

## v0.2.0 Slack Live Smoke Result

Date: 2026-04-17

Repository: disposable test repository configured as `repo:default`

Result:

- Slack ask mode answered a read-only package-name question without approval, diff cards, or PR controls.
- A follow-up ask in the same Slack thread reused the existing session and answered a root-file question.
- A plan/approval task created an isolated session worktree, wrote the requested smoke markdown file, and kept the source repository clean.
- The Slack diff-summary action opened successfully and displayed only bounded repository, branch, status, changed-file, diff-stat, and name-status details.
- Live validation found and fixed runner-authored local path exposure in Slack plan text.
- Live validation found and fixed a details-action session lookup gap for Slack action payloads that omit task metadata.

Notes:

- A stale duplicate local gateway process caused one transient stale-approval failure during smoke testing. The process was removed, a single gateway/runner pair was restarted, and the patched smoke passed.
- Automated Slack smoke posting remains optional and local-only. It requires locally configured smoke identity values and does not require tracking Slack IDs or tokens.
- Slash commands, App Home/status surfaces, and current PR lifecycle behavior were tightened after the `v0.2.0` live smoke in `CFO-0047` with deterministic tests.

## v0.2.1 Slack UX Follow-Up Validation Result

Date: 2026-04-17

Repository: disposable test repository configured as `repo:default`

Result:

- `/codex status` returned the expected status response through the live Slack app.
- `/codex new` opened a live planning flow against the disposable repo.
- App Home showed recent session and audit state for the live task.
- App Home approval accepted the execution request, removed the Home approval button, and refreshed the original thread approval card.
- The implementation completed in an isolated worktree and the disposable source repo remained clean.
- Create PR, PR status, and Ready for review actions completed through Slack against the disposable repo.

Notes:

- The live pass found that App Home approval refreshed the Home surface but left the original thread approval button visible. The action handler now locates and replaces the source thread approval card after acceptance, and focused regression coverage verifies that behavior.
- Public validation notes intentionally omit Slack IDs, PR URLs, local machine paths, tokens, and live task content.

## v0.2.0 Email Live Validation Result

Date: 2026-04-17

Transport: generic SMTP/IMAP through a local mailbox bridge

Result:

- Outbound SMTP lifecycle mail succeeded.
- IMAP ask intake queued a read-only ask task, the runner completed the answer, and an outbound answer email was sent.
- Reply continuation using a `relay:<sessionId>` marker routed to the existing session and completed as a read-only ask task.
- Relay-started local session handoff sent a plan-ready email summary.
- Email direct workspace intake reached the runner against a disposable repository, but the Windows Codex write sandbox denied writes and the source repository remained unchanged.

Notes:

- The direct-workspace write denial is treated as a local Codex CLI Windows sandbox/runtime blocker, not a Relay routing blocker.
- Email-originated write approvals remain intentionally deferred.
- Provider-specific Gmail live validation is deferred; `v0.2.0` releases the generic disabled-by-default SMTP/IMAP foundation and provider setup documentation.

## GitHub Repository Posture

Checked on 2026-04-15 with the authenticated GitHub CLI session:

- Repository: `josephbartlett/codex-relay`
- Visibility: public
- Default branch: `main`
- Issues: enabled
- Wiki: disabled
- Security policy: enabled at https://github.com/josephbartlett/codex-relay/security/policy
- Authenticated permission: admin
- Branch protection: not enabled at the time of the latest check. Enable branch protection for `main` once collaboration settings are finalized.

## Known Limitations

These are acceptable for the `v0.2.x` local-first release line if they remain documented:

- `ExecAdapter` is the only implemented runner adapter.
- Slack gateway direct execution remains the default solo-local path.
- Durable queue, runner leases, worker daemon, and queued Slack notifications exist, but Slack mention/action flows are not queue-by-default yet.
- The audit viewer is local/read-only and remote mode requires explicit operator hardening.
- Brand and diagram assets remain untracked until rendered screenshot review and maintainer approval.
- Email control-plane support is disabled by default and limited to generic SMTP/IMAP ask, reply continuation, local handoff summaries, and lifecycle notifications.
- Email-originated write approvals remain deferred until a nonce-bound or signed approval design is implemented.
- Provider-specific Gmail live validation is deferred to a future provider-validation release.
- Direct workspace quick mode is disabled by default and should be used only for trusted solo repositories after reviewing the security docs.
- `SdkAdapter`, `AppServerAdapter`, multi-runner pools, and container isolation are deferred.

## Tag Recommendation

Do not tag a release until:

- `npm run check` passes on a clean checkout;
- release notes are finalized;
- a maintainer explicitly approves the tag.

Operator note: before normal post-release live use, run `npm run validate:live-config` and update the protected `.env` values if it reports missing strict-mode Slack policy.
