# Decision Tracking

Use decision records when a choice affects architecture, security, release process, persistence, Slack UX, runner behavior, or long-term maintenance.

## When To Use The Decision Log

Use `docs/DECISIONS.md` for short decisions that fit in a few paragraphs.

Examples:

- Storage backend choice.
- Release process rules.
- Security default changes.
- Slack interaction policy.

## When To Add An ADR

Use `docs/ADRs/` for larger decisions that need context, alternatives, and consequences.

Examples:

- Replacing `ExecAdapter` with SDK/app-server flows.
- Introducing a multi-runner queue.
- Changing authorization policy semantics.
- Choosing deployment architecture for team mode.

## ADR Format

Copy `docs/templates/ADR.md` and name the file:

```text
docs/ADRs/0003-short-title.md
```

Keep ADRs immutable after acceptance except for minor corrections. If a decision changes, write a new ADR that supersedes the older one.

## Required Sections

- Status.
- Context.
- Decision.
- Consequences.
- Security impact, if applicable.
- Alternatives considered.
