# Contributing

Codex Relay is early, security-sensitive infrastructure. Contributions should improve reliability, safety, Slack usability, runner isolation, or release hygiene.

## Development Setup

```bash
npm install
cp .env.example .env
npm run check
```

Do not put real tokens in examples, tests, screenshots, issues, or pull requests.

## Required Checks

Run the full local gate before opening a pull request:

```bash
npm run check
```

This runs:

- TypeScript typecheck.
- Production build.
- Test suite.
- Secret scanner for common token/private-key mistakes.

## Commit Style

Use Conventional Commits:

```text
feat: add SQLite persistence
fix: sanitize PR summaries before GitHub creation
docs: document Slack app setup
test: cover duplicate PR creation
chore: update release checklist
```

Allowed common types:

- `feat`
- `fix`
- `docs`
- `test`
- `refactor`
- `chore`
- `ci`
- `build`
- `security`

## Pull Request Standards

Every PR should include:

- Summary of user-facing or operational behavior.
- Security impact.
- Tests run.
- Documentation updated or explanation for why docs are not needed.
- Linked task, issue, ADR, or roadmap item when applicable.

## Publication And Push Policy

Local commits are acceptable for verified work. Publishing is a separate maintainer-controlled step.

- Default public-repo handoff is branch plus pull request.
- Do not push directly to `main` unless a maintainer explicitly asks for that direct push for the current operation.
- Do not push tags, create GitHub releases, or change repository settings without explicit maintainer approval for the current operation.
- A maintainer may approve a direct push for a narrow cleanup or release operation; record the approval-sensitive work in the relevant packet, task, changelog, or maintenance audit entry.

## Delegating Work

The full operating model lives in `docs/AGENT_ORCHESTRATION.md`.

- Use subagents for isolated, testable chunks with clear file ownership.
- Do not let two active agents edit the same files at once unless one is explicitly reviewing the other's patch.
- State the owned paths, expected result, and verification command before starting delegated work.
- Use `docs/templates/DELEGATION_PACKET.md` for non-trivial assignments.
- When a delegated chunk finishes, record the outcome in `docs/TASKS.md` and note any follow-up in `docs/DECISIONS.md` if the work changed policy or process.
- Reviewers should check the touched file list, the verification output, and any remaining risk before merging.
- Prefer small, complete handoffs over open-ended collaboration loops.

## Security Expectations

Before submitting code, verify:

- No secrets, tokens, local paths containing secrets, or credential material are committed.
- Slack actions that mutate state check authorization.
- Repo paths come only from configured repo bindings.
- Write-capable Codex runs use isolated worktrees.
- Dangerous sandbox or approval settings are not introduced as defaults.
- Logs do not expose Slack text, prompts, diffs, command output, or credentials unnecessarily.

Security-sensitive changes should update `SECURITY.md` and `docs/SECURITY.md`.

## Documentation Standards

- Public project direction lives in `docs/ROADMAP.md`.
- Work tracking lives in `docs/TASKS.md`.
- Durable decisions live in `docs/DECISIONS.md` or `docs/ADRs/`.
- Operational procedures live in `docs/RUNBOOK.md`.
- Release-facing changes live in `CHANGELOG.md`.

## Release Standards

This project uses Semantic Versioning. `v0.1.0` was the first public release.

Do not create a release tag until:

- `npm run check` passes.
- `CHANGELOG.md` has a release entry.
- `docs/ROADMAP.md` and `docs/TASKS.md` reflect the release state.
- Security docs are current.
- A maintainer explicitly approves the tag and release publication.
