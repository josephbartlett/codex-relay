# Security Review Packet

Create the machine-readable record from `docs/templates/WORK_PACKET.yaml`, then set `role: reviewer`.

## Objective

State the security property, boundary, or change to assess.

## Owner

- Lead:
- Security reviewer:
- System owner:

## Owned Paths

- `path/or/directory`

## Dependencies

- Threat model, policy files, auth code, logging code, or release notes.

## Non-Goals

- List what this packet must not change.

## Acceptance Criteria

- [ ] Authorization and trust boundaries are reviewed.
- [ ] Secret handling and logging are reviewed.
- [ ] Dangerous defaults or escalation paths are identified.
- [ ] Required mitigations are either implemented or explicitly accepted.
- [ ] Audit notes are recorded.

## Verification

Expected command, review, or test:

```bash
npm run check
```

## Audit Notes

- Risks identified.
- Evidence reviewed.
- Mitigations confirmed or deferred.

## Handoff

Return:

- Findings.
- Severity.
- Evidence.
- Recommended fix or acceptance decision.
