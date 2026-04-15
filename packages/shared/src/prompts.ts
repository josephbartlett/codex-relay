import type { SlackTaskContext } from "./types.js";

export interface PlanPromptInput {
  slack: SlackTaskContext;
  repoId: string;
}

export interface ImplementPromptInput {
  slack: SlackTaskContext;
  planSummary: string;
}

export interface FollowUpPlanPromptInput extends PlanPromptInput {
  previousSummary?: string;
  intent: "continue" | "revise_plan";
}

export interface TestPlanPromptInput extends PlanPromptInput {
  previousSummary?: string;
}

export interface LocalHandoffPromptInput extends PlanPromptInput {
  mode: "implement" | "test";
  previousSummary?: string;
}

export function buildPlanPrompt(input: PlanPromptInput): string {
  return [
    "You are running inside Codex Relay plan phase.",
    "",
    "Hard rules:",
    "- Read only. Do not edit files.",
    "- Do not run network commands.",
    "- Inspect just enough repository context to make a concrete implementation plan.",
    "- Identify likely files, tests, risks, and any commands that would be needed during implementation.",
    "- If the request is unsafe, ambiguous, or outside the configured repository, say so clearly.",
    "",
    `Repo id: ${input.repoId}`,
    `Slack requester: ${input.slack.requestingUserId}`,
    "",
    "Slack request:",
    input.slack.text,
    input.slack.selectedMessageText
      ? ["", "Selected Slack message context:", input.slack.selectedMessageText].join("\n")
      : "",
    "",
    "Return a concise plan with these headings:",
    "Summary",
    "Proposed edits",
    "Tests",
    "Risks",
    "Approval notes"
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildFollowUpPlanPrompt(input: FollowUpPlanPromptInput): string {
  return [
    "You are running inside Codex Relay follow-up plan phase.",
    "",
    "Hard rules:",
    "- Read only. Do not edit files.",
    "- Do not run network commands.",
    "- Continue from the existing session context.",
    "- If the follow-up changes the requested work, produce a replacement plan.",
    "- Identify likely files, tests, risks, and approval notes.",
    "",
    `Repo id: ${input.repoId}`,
    `Slack requester: ${input.slack.requestingUserId}`,
    `Follow-up intent: ${input.intent}`,
    input.previousSummary ? ["", "Previous run summary:", input.previousSummary].join("\n") : "",
    "",
    "Slack request:",
    input.slack.text,
    input.slack.selectedMessageText
      ? ["", "Selected Slack message context:", input.slack.selectedMessageText].join("\n")
      : "",
    "",
    "Return a concise plan with these headings:",
    "Summary",
    "Proposed edits",
    "Tests",
    "Risks",
    "Approval notes"
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTestPlanPrompt(input: TestPlanPromptInput): string {
  return [
    "You are running inside Codex Relay test-planning phase.",
    "",
    "Hard rules:",
    "- Read only. Do not edit files.",
    "- Do not run tests yet.",
    "- Identify the smallest relevant deterministic checks for this session.",
    "- Assume checks may execute repository code and may write caches or artifacts.",
    "- If the requested checks are unsafe, ambiguous, or require network access, say so clearly.",
    "",
    `Repo id: ${input.repoId}`,
    `Slack requester: ${input.slack.requestingUserId}`,
    input.previousSummary ? ["", "Previous run summary:", input.previousSummary].join("\n") : "",
    "",
    "Slack request:",
    input.slack.text,
    "",
    "Return a concise test plan with these headings:",
    "Summary",
    "Commands",
    "Expected impact",
    "Risks",
    "Approval notes"
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildImplementPrompt(input: ImplementPromptInput): string {
  return [
    "You are running inside Codex Relay implementation phase.",
    "",
    "Hard rules:",
    "- Implement only the approved plan.",
    "- Stay inside the current git worktree.",
    "- Do not use network commands unless the plan explicitly says network is required and allowed.",
    "- Run the smallest relevant tests or checks.",
    "- Summarize changed files and verification results at the end.",
    "",
    "Original Slack request:",
    input.slack.text,
    "",
    "Approved plan:",
    input.planSummary
  ].join("\n");
}

export function buildTestRunPrompt(input: ImplementPromptInput): string {
  return [
    "You are running inside Codex Relay approved test execution phase.",
    "",
    "Hard rules:",
    "- Run only the approved tests or checks.",
    "- Stay inside the current git worktree.",
    "- Do not make source edits.",
    "- Do not use network commands unless the approved test plan explicitly says network is required and allowed.",
    "- Summarize commands, pass/fail results, and any files changed by test artifacts.",
    "",
    "Original Slack request:",
    input.slack.text,
    "",
    "Approved test plan:",
    input.planSummary
  ].join("\n");
}

export function buildLocalHandoffPrompt(input: LocalHandoffPromptInput): string {
  return [
    input.mode === "test"
      ? "You are running inside Codex Relay local handoff test execution."
      : "You are running inside Codex Relay local handoff implementation.",
    "",
    "Context:",
    "- The local operator explicitly started this run from the machine hosting Codex Relay.",
    "- The run is bound to a Slack thread so the operator can leave and continue remotely.",
    "",
    "Hard rules:",
    "- Stay inside the current git worktree.",
    "- Do not use network commands unless the request explicitly requires it and local policy allows it.",
    input.mode === "test"
      ? "- Run only the smallest relevant checks and avoid source edits unless required by test artifacts."
      : "- Make only the requested changes and run the smallest relevant verification.",
    "- Summarize changed files, verification, and next suggested action at the end.",
    "",
    `Repo id: ${input.repoId}`,
    `Slack requester: ${input.slack.requestingUserId}`,
    input.previousSummary ? ["", "Previous run summary:", input.previousSummary].join("\n") : "",
    "",
    "Local handoff request:",
    input.slack.text,
    input.slack.selectedMessageText
      ? ["", "Selected Slack message context:", input.slack.selectedMessageText].join("\n")
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}
