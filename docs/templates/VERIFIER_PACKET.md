# Verifier Packet

Create the machine-readable record from `docs/templates/WORK_PACKET.yaml`, then set `role: verifier`.

## Objective

State the expected behavior or claim to verify.

## Owner

- Lead:
- Verifier:
- Reviewer:

## Owned Paths

- `path/or/directory`

## Dependencies

- Implementation packet, release candidate, or test plan.

## Non-Goals

- List what this packet must not change.

## Acceptance Criteria

- [ ] The claimed behavior is verified.
- [ ] Commands or manual checks are recorded.
- [ ] Failures are reproduced or ruled out.
- [ ] Audit notes are recorded.

## Verification

Commands or manual checks:

```bash
npm test
```

## Audit Notes

- What was verified.
- What failed.
- What evidence supports the conclusion.

## Handoff

Return:

- Verification outcome.
- Evidence.
- Remaining risks.
- Recommended next step.
