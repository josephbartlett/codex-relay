# Brand Notes

Codex Relay is infrastructure, but it should still have a recognizable identity. The tone should feel capable, local-first, secure, and useful from a phone.

## Name

Primary name: **Codex Relay**

Use "Codex Relay" in public docs, GitHub metadata, release notes, and Slack app copy.

Avoid the older internal name "Codex Slack Harness" except when explaining history.

## One-Line Description

Slack control plane for local and self-hosted Codex execution.

## Community ASCII Banner

Use this in local tooling, setup output, or release notes where plain text is appropriate:

```text
   ______          __             ____       __
  / ____/___  ____/ /__  _  __   / __ \\___  / /___ ___  __
 / /   / __ \\/ __  / _ \\| |/_/  / /_/ / _ \\/ / __ `/ / / /
/ /___/ /_/ / /_/ /  __/>  <   / _, _/  __/ / /_/ / /_/ /
\\____/\\____/\\__,_/\\___/_/|_|  /_/ |_|\\___/_/\\__,_/\\__, /
                                                  /____/
```

Compact form:

```text
Codex Relay :: Slack control plane, Codex execution plane
```

## Visual Direction

Recommended motifs:

- Relay tower, signal path, handoff, queue, or branch/worktree imagery.
- Clear technical lines rather than mascot-first branding.
- Light and dark variants from the start.
- SVG source files only after maintainer approval.

Avoid:

- Slack or OpenAI logo imitation.
- Visuals that imply official Slack/OpenAI endorsement.
- Security theater imagery such as locks everywhere.
- Unreviewed AI-generated assets in tracked source.

## Asset Workflow

Generated or experimental assets belong in `brand-candidates/`, which is intentionally ignored by git.

Promotion path:

1. Create candidates in `brand-candidates/`.
2. Review visually and legally.
3. Select one candidate.
4. Move the approved source into a tracked `assets/` path in a separate commit.
5. Record the decision in `docs/DECISIONS.md` or an ADR.

## Candidate Ideas

- Wordmark: `Codex Relay` with a simple signal path between the words.
- Icon: three connected nodes forming a path from Slack to runner to repo.
- Release badge: minimal relay tower line art plus version text.
- CLI banner: ASCII banner above startup validation output.
- Architecture diagrams: dark control-plane surface with relay/signal paths for Slack, orchestration, security, and runner boundaries.
