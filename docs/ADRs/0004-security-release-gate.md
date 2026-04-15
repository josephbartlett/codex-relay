# ADR-0004: Security As A Release Gate

## Status

Accepted

## Context

Codex Relay lets Slack users trigger local or self-hosted code execution. Mistakes in authorization, repo binding, sandbox policy, logging, or persistence can expose end users to unauthorized code changes or secret leakage.

## Decision

Treat security as a release gate for `v0.1.0`.

Release-blocking security work includes:

- User, channel, and repo authorization policy.
- Secret scanning in local and CI checks.
- Dependency audit in local and CI checks.
- Threat model documentation.
- PR template security impact section.
- Tests for denied authorization paths.
- Explicit safe defaults for runner sandbox and approval policy.

## Consequences

- Some product work may wait behind policy and test coverage.
- Every meaningful PR must discuss security impact.
- `npm run check` is the baseline local gate.

## Security Impact

This decision reduces the chance that the first public release normalizes unsafe defaults or incomplete authorization.

## Alternatives Considered

- Ship the local MVP first and harden later: rejected because the product controls code execution.
- Require external security tooling only: rejected because contributors need local checks that run before CI.
