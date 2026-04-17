import type { Block, KnownBlock } from "@slack/types";
import type {
  ApprovalRequest,
  DraftPullRequestLifecycleResult,
  DraftPullRequestReadyResult,
  DraftPullRequestStatus,
  Session
} from "../../../../packages/shared/src/types.js";
import { SlackActionIds } from "../../../../packages/shared/src/events.js";
import type { DiffSummary } from "../../../orchestrator/src/artifacts.js";
import { sanitizeNotificationText } from "../../../orchestrator/src/slackNotifications.js";

export type SlackBlock = KnownBlock | Block;

export function kickoffBlocks(input: { repoId: string; branchName: string; status: string; mode?: string }): SlackBlock[] {
  return [
    section(
      [
        "*Codex task started*",
        `Repo: \`${escapeBackticks(input.repoId)}\``,
        `Mode: \`${escapeBackticks(input.mode ?? "plan")}\``,
        `Branch: \`${escapeBackticks(input.branchName)}\``,
        `Status: ${safeSlackText(input.status)}`
      ].join("\n")
    ),
    actions([
      button("Open details", SlackActionIds.openDetails, "details"),
      button("Cancel", SlackActionIds.cancelTask, "cancel", "danger")
    ])
  ];
}

export function planBlocks(approval: ApprovalRequest): SlackBlock[] {
  const approvalLabel = approval.type === "run_tests" ? "Approve test run" : "Approve execution";

  return [
    section(`*Plan ready*\n${truncate(safeSlackText(approval.summary), 2500)}`),
    context(`Approval expires: ${new Date(approval.expiresAt).toLocaleString()}`),
    actions([
      button(approvalLabel, SlackActionIds.approveExecution, approval.id, "primary"),
      button("Revise", SlackActionIds.revisePlan, approval.id),
      button("Cancel", SlackActionIds.cancelTask, approval.taskRunId, "danger")
    ])
  ];
}

export function progressBlocks(input: { title: string; detail: string }): SlackBlock[] {
  return [section(`*${safeSlackText(input.title)}*\n${truncate(safeSlackText(input.detail), 2500)}`)];
}

export function guidanceBlocks(input: { title: string; detail: string }): SlackBlock[] {
  return [section(`*${safeSlackText(input.title)}*\n${truncate(safeSlackText(input.detail), 2500)}`)];
}

export function answerBlocks(input: { session: Session; answer: string }): SlackBlock[] {
  return [
    section(
      [
        "*Answer*",
        `Repo: \`${escapeBackticks(input.session.repoId)}\``,
        "",
        truncate(safeSlackText(input.answer), 2500)
      ].join("\n")
    )
  ];
}

export function completionBlocks(input: {
  session: Session;
  summary: string;
  diff: DiffSummary;
  mode?: "implement" | "test";
}): SlackBlock[] {
  const mode = input.mode ?? "implement";
  const sourceWorkspace = input.session.workspaceKind === "source";
  const files =
    input.diff.changedFiles.length > 0
      ? formatChangedFiles(input.diff.changedFiles)
      : "No changed files detected.";

  return [
    section(
      [
        mode === "test" ? "*Tests completed*" : "*Completed*",
        `Summary: ${truncate(safeSlackText(input.summary), 1200)}`,
        `Branch: \`${escapeBackticks(input.session.branchName)}\``,
        ...(input.session.draftPullRequest ? [`PR: ${escapeSlackText(input.session.draftPullRequest.prUrl)}`] : []),
        `Files changed: ${input.diff.changedFiles.length}`
      ].join("\n")
    ),
    section(files),
    input.diff.diffStat ? section(`*Diff stat*\n\`\`\`\n${truncate(safeSlackText(input.diff.diffStat), 1800)}\n\`\`\``) : context("No diff stat."),
    mode === "test" || sourceWorkspace
      ? actions([button("Show diff summary", SlackActionIds.openDetails, input.session.id)])
      : actions([
          button("Show diff summary", SlackActionIds.openDetails, input.session.id),
          input.session.draftPullRequest
            ? button("Update PR", SlackActionIds.createPr, input.session.id)
            : button("Create PR", SlackActionIds.createPr, input.session.id),
          ...(input.session.draftPullRequest
            ? [
                button("PR status", SlackActionIds.checkPrStatus, input.session.id),
                ...(input.session.draftPullRequest.readyForReviewAt
                  ? []
                  : [button("Ready for review", SlackActionIds.markPrReady, input.session.id, "primary")]),
                linkButton("Open PR", input.session.draftPullRequest.prUrl)
              ]
            : [])
        ])
  ];
}

export function failureBlocks(input: { title: string; error: string }): SlackBlock[] {
  return [section(`*${safeSlackText(input.title)}*\n${truncate(safeSlackText(input.error), 2500)}`)];
}

export function diffSummaryBlocks(input: { session: Session; diff: DiffSummary }): SlackBlock[] {
  const files =
    input.diff.changedFiles.length > 0
      ? formatChangedFiles(input.diff.changedFiles)
      : "No changed files detected.";

  return [
    section(
      [
        "*Diff summary*",
        `Repo: \`${escapeBackticks(input.session.repoId)}\``,
        `Branch: \`${escapeBackticks(input.session.branchName)}\``,
        `Files changed: ${input.diff.changedFiles.length}`
      ].join("\n")
    ),
    section(files),
    input.diff.diffStat ? section(`*Diff stat*\n\`\`\`\n${truncate(safeSlackText(input.diff.diffStat), 1800)}\n\`\`\``) : context("No diff stat.")
  ];
}

export function sessionSummaryBlocks(input: { session: Session; title: string; detail: string }): SlackBlock[] {
  const detail = truncate(safeSlackText(input.detail), 1800);
  const actionButtons: SlackBlock[] = [button("Show diff summary", SlackActionIds.openDetails, input.session.id)];

  if (input.session.status === "done" && input.session.workspaceKind !== "source") {
    actionButtons.push(
      input.session.draftPullRequest
        ? button("Update PR", SlackActionIds.createPr, input.session.id)
        : button("Create PR", SlackActionIds.createPr, input.session.id)
    );

    if (input.session.draftPullRequest) {
      actionButtons.push(button("PR status", SlackActionIds.checkPrStatus, input.session.id));
      actionButtons.push(linkButton("Open PR", input.session.draftPullRequest.prUrl));
    }
  }

  return [
    section(
      [
        `*${safeSlackText(input.title)}*`,
        `Repo: \`${escapeBackticks(input.session.repoId)}\``,
        `Status: \`${escapeBackticks(input.session.status)}\``,
        `Branch: \`${escapeBackticks(input.session.branchName)}\``,
        "",
        detail
      ].join("\n")
    ),
    context("Reply in this thread and mention Codex Relay to continue the saved session."),
    actions(actionButtons)
  ];
}

export function prLifecycleBlocks(input: { lifecycle: DraftPullRequestLifecycleResult; session: Session }): SlackBlock[] {
  const title =
    input.lifecycle.operation === "created"
      ? "*Draft PR created*"
      : input.lifecycle.operation === "updated"
        ? "*Draft PR updated*"
        : "*Draft PR already current*";

  return [
    section(
      [
        title,
        `PR: ${escapeSlackText(input.lifecycle.result.prUrl)}`,
        `Branch: \`${escapeBackticks(input.lifecycle.result.branchName)}\``,
        `Commit: \`${escapeBackticks(input.lifecycle.result.commitSha.slice(0, 12))}\``,
        `Files: ${input.lifecycle.result.changedFiles.length}`
      ].join("\n")
    ),
    actions([
      button("PR status", SlackActionIds.checkPrStatus, input.session.id),
      ...(input.session.draftPullRequest?.readyForReviewAt
        ? []
        : [button("Ready for review", SlackActionIds.markPrReady, input.session.id, "primary")]),
      linkButton("Open PR", input.lifecycle.result.prUrl)
    ])
  ];
}

export function prReadyBlocks(input: { ready: DraftPullRequestReadyResult; session: Session }): SlackBlock[] {
  const checkDetails = formatCheckDetails(input.ready);

  return [
    section(
      [
        input.ready.operation === "ready" ? "*PR marked ready for review*" : "*PR already ready for review*",
        `PR: ${escapeSlackText(input.ready.prUrl)}`,
        ...(typeof input.ready.isDraft === "boolean" ? [`Draft: \`${input.ready.isDraft ? "yes" : "no"}\``] : []),
        ...(input.ready.headRefName ? [`Branch: \`${escapeBackticks(input.ready.headRefName)}\``] : []),
        `Checks: ${escapeSlackText(input.ready.checksSummary)}`
      ].join("\n")
    ),
    ...(checkDetails ? [section(`*Check details*\n${checkDetails}`)] : []),
    actions([button("PR status", SlackActionIds.checkPrStatus, input.session.id), linkButton("Open PR", input.ready.prUrl)]),
    context(`Updated: ${new Date(input.ready.checkedAt).toLocaleString()}`)
  ];
}

export function prStatusBlocks(input: { status: DraftPullRequestStatus; session?: Session }): SlackBlock[] {
  const checkDetails = formatCheckDetails(input.status);
  const blocks: SlackBlock[] = [
    section(
      [
        "*Draft PR status*",
        `PR: ${escapeSlackText(input.status.prUrl)}`,
        ...(input.status.state ? [`State: \`${escapeBackticks(input.status.state)}\``] : []),
        ...(typeof input.status.isDraft === "boolean" ? [`Draft: \`${input.status.isDraft ? "yes" : "no"}\``] : []),
        ...(input.status.mergeable ? [`Mergeable: \`${escapeBackticks(input.status.mergeable)}\``] : []),
        ...(input.status.headRefName ? [`Branch: \`${escapeBackticks(input.status.headRefName)}\``] : []),
        `Checks: ${escapeSlackText(input.status.checksSummary)}`
      ].join("\n")
    ),
    ...(checkDetails ? [section(`*Check details*\n${checkDetails}`)] : []),
    context(`Checked: ${new Date(input.status.checkedAt).toLocaleString()}`)
  ];

  if (input.session?.draftPullRequest && input.status.isDraft !== false && !input.session.draftPullRequest.readyForReviewAt) {
    blocks.push(
      actions([
        button("Ready for review", SlackActionIds.markPrReady, input.session.id, "primary"),
        linkButton("Open PR", input.status.prUrl)
      ])
    );
  }

  return blocks;
}

function section(text: string): SlackBlock {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text
    }
  };
}

function context(text: string): SlackBlock {
  return {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text
      }
    ]
  };
}

function actions(elements: SlackBlock[]): SlackBlock {
  return {
    type: "actions",
    elements
  } as SlackBlock;
}

function button(
  text: string,
  actionId: string,
  value: string,
  style?: "primary" | "danger"
): SlackBlock {
  return {
    type: "button",
    text: {
      type: "plain_text",
      text
    },
    action_id: actionId,
    value,
    ...(style ? { style } : {})
  } as SlackBlock;
}

function linkButton(text: string, url: string): SlackBlock {
  return {
    type: "button",
    text: {
      type: "plain_text",
      text
    },
    url
  } as SlackBlock;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 20)}\n... truncated ...`;
}

function formatChangedFiles(files: string[]): string {
  const visibleFiles = files.slice(0, 25);
  const hiddenCount = files.length - visibleFiles.length;
  const rendered = visibleFiles.map((file) => `- \`${escapeBackticks(file)}\``);

  if (hiddenCount > 0) {
    rendered.push(`- ... ${hiddenCount} more file(s) hidden from Slack summary.`);
  }

  return truncate(rendered.join("\n"), 2500);
}

function formatCheckDetails(status: DraftPullRequestStatus): string | undefined {
  const details = status.checkDetails ?? [];

  if (details.length === 0) {
    return undefined;
  }

  const visibleChecks = details.slice(0, 8);
  const hiddenCount = details.length - visibleChecks.length + (status.checksHidden ?? 0);
  const rendered = visibleChecks.map((check) => {
    const name = check.url
      ? `<${check.url}|${escapeSlackLinkLabel(check.name)}>`
      : `\`${escapeBackticks(check.name)}\``;
    const rawState = check.conclusion ?? check.status;
    const suffix = rawState ? ` - ${escapeSlackText(rawState)}` : "";
    return `- [${check.state}] ${name}${suffix}`;
  });

  if (hiddenCount > 0) {
    rendered.push(`- ... ${hiddenCount} more check(s) hidden from Slack summary.`);
  }

  return truncate(rendered.join("\n"), 1800);
}

function escapeSlackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeSlackText(value: string): string {
  return escapeSlackText(sanitizeNotificationText(value, 10_000));
}

function escapeSlackLinkLabel(value: string): string {
  return escapeSlackText(value).replace(/\|/g, "/");
}

function escapeBackticks(value: string): string {
  return escapeSlackText(value).replace(/`/g, "'");
}
