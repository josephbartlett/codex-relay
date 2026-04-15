import type { SlackTaskContext } from "../../../packages/shared/src/types.js";

export type FollowUpIntent =
  | "new_task"
  | "continue"
  | "revise_plan"
  | "run_tests"
  | "summarize_diff"
  | "update_pr"
  | "ready_for_review"
  | "cancel"
  | "unsupported";

export function extractRepoId(text: string): string | undefined {
  const match = text.match(/\brepo:([a-zA-Z0-9._-]+)/);
  return match?.[1];
}

export function stripBotMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

export function classifyFollowUpIntent(input: { text: string; hasExistingSession: boolean }): FollowUpIntent {
  const normalized = normalizeIntentText(stripBotMention(input.text));

  if (!normalized) {
    return "unsupported";
  }

  if (!input.hasExistingSession && extractRepoId(input.text)) {
    return "new_task";
  }

  if (/\b(cancel|stop|abort)\b/u.test(normalized)) {
    return "cancel";
  }

  if (/\b(ready|publish|undraft|finali[sz]e)\b/u.test(normalized) && /\b(review|pr|pull request)\b/u.test(normalized)) {
    return "ready_for_review";
  }

  if (
    /\b(create|draft|make|open|update|refresh|sync)\b/u.test(normalized) &&
    /\b(pr|pull request)\b/u.test(normalized)
  ) {
    return "update_pr";
  }

  if (/\b(show|summari[sz]e|open|view|check)\b/u.test(normalized) && /\b(diff|changes|changed files)\b/u.test(normalized)) {
    return "summarize_diff";
  }

  if (/\b(revise|adjust|change|redo|update)\b/u.test(normalized) && /\b(plan|proposal)\b/u.test(normalized)) {
    return "revise_plan";
  }

  if (/\b(run|execute|check)\b/u.test(normalized) && /\b(test|tests|typecheck|build|lint|checks)\b/u.test(normalized)) {
    return "run_tests";
  }

  if (/\b(continue|proceed|resume|keep going|carry on|implement|fix|add|change|inspect|review|explain|try)\b/u.test(normalized)) {
    return input.hasExistingSession ? "continue" : "new_task";
  }

  return input.hasExistingSession ? "unsupported" : "new_task";
}

export function normalizeFollowUpText(input: { intent: FollowUpIntent; text: string }): string {
  const text = stripBotMention(input.text);

  if (input.intent === "revise_plan") {
    return [
      "Revise the previous plan based on this follow-up. Do not execute changes yet.",
      "",
      "Follow-up request:",
      text
    ].join("\n");
  }

  if (input.intent === "run_tests") {
    return [
      "Plan a test/check run for this session. Identify the smallest relevant commands and whether they may write files.",
      "Do not execute checks until Slack approval is granted.",
      "",
      "Follow-up request:",
      text
    ].join("\n");
  }

  return text;
}

export function buildSlackTaskContext(input: {
  teamId: string;
  channelId: string;
  threadTs: string;
  requestingUserId: string;
  text: string;
  selectedMessageText?: string;
  permalink?: string;
}): SlackTaskContext {
  return {
    thread: {
      teamId: input.teamId,
      channelId: input.channelId,
      threadTs: input.threadTs
    },
    requestingUserId: input.requestingUserId,
    text: stripBotMention(input.text),
    selectedMessageText: input.selectedMessageText,
    permalink: input.permalink
  };
}

function normalizeIntentText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\brepo:[a-z0-9._-]+\b/gu, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
