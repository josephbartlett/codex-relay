# Release Packet

Create the machine-readable record from `docs/templates/WORK_PACKET.yaml`, then set `role: release`.

## Objective

State the release goal and release boundary.

## Owner

- Lead:
- Release owner:
- Reviewer:

## Owned Paths

- `path/or/directory`

## Dependencies

- Versioning policy, changelog, tags, CI, or deployment notes.

## Non-Goals

- List what this packet must not change.

## Acceptance Criteria

- [ ] Version, changelog, and release notes are updated.
- [ ] Release verification is complete.
- [ ] Rollback or follow-up steps are known.
- [ ] Audit notes are recorded.

## Verification

Expected command or release check:

```bash
npm run check
```

## Audit Notes

- What is included in the release.
- What was verified.
- What remains intentionally out of scope.

## Handoff

Return:

- Release summary.
- Verification.
- Risks.
- Publish or tag recommendation.
