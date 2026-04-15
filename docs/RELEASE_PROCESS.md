# Release Process

Codex Relay uses Semantic Versioning.

## Versioning

Format:

```text
MAJOR.MINOR.PATCH
```

Rules:

- MAJOR: incompatible config, storage, API, or operating model changes after public stabilization.
- MINOR: new compatible product capability.
- PATCH: compatible bug, security, documentation, or operational fix.

Pre-1.0 releases may still change quickly, but release notes must call out migration impact.

## First Release

The first official release was `v0.1.0`.

Future releases should keep acceptance criteria in `docs/ROADMAP.md` complete or explicitly deferred with a decision record.

## Publication Authority

Local commits are allowed as verified checkpoints. Publishing is separate.

- Do not push directly to `main` without explicit maintainer approval for that operation.
- Do not push release tags without explicit maintainer approval for that operation.
- Do not create or edit GitHub releases without explicit maintainer approval for that operation.
- Default to branch-and-PR handoff for public repository changes unless the maintainer asks for a direct push.

## Release Checklist

1. Confirm `npm run check` passes.
2. Confirm release readiness passes with `npm run check:release`.
3. Confirm no secrets are present with `npm run check:secrets`.
4. Confirm setup validation passes with `npm run validate:setup`.
5. Review `docs/SECURITY.md` and top-level `SECURITY.md`.
6. Review `docs/RELEASE_READINESS.md`.
7. Review SQLite backup/restore notes in `docs/RUNBOOK.md`.
8. Update `CHANGELOG.md`.
9. Update `docs/TASKS.md`.
10. Update `docs/ROADMAP.md`.
11. Verify `.env.example` covers all required config.
12. Run a live local smoke test against a disposable or test repository.
13. Validate the operator `.env` posture without printing values:

```bash
npm run validate:live-config
```

14. Create a release commit.
15. Tag with `vMAJOR.MINOR.PATCH`.
16. Push the tag.
17. Create a GitHub release from the changelog entry.

## Release Readiness Gate

Run:

```bash
npm run check:release
```

This gate verifies that required public files exist, package metadata is consistent with the current release line, changelog and release docs have the expected sections, CI uses `npm ci` and `npm run check`, local-only runtime paths are not tracked, and tracked Markdown files have balanced fenced code blocks.

`npm run check` also runs this gate. Keep it deterministic and Slack-less so CI can execute it without credentials.

`npm run validate:live-config` intentionally stays outside `npm run check` because CI and fresh installs should not require local Slack tokens or operator `.env` values. It validates the protected local `.env` posture for real Slack operation and reports only pass/fail facts, not token or secret values.

## Tag Format

```bash
git tag -a v0.1.0 -m "Codex Relay v0.1.0"
git push origin v0.1.0
```

## Release Notes

Release notes should include:

- Summary.
- Added/changed/fixed/security sections.
- Migration notes.
- Known limitations.
- Verification command output summary.
- Setup validation result.
- Release-readiness result.
- Live smoke-test summary or a clear reason for deferral.
