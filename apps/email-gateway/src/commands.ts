import { normalizeEmailAddress, resolveRepoBinding, type HarnessConfig } from "../../../packages/shared/src/config.js";
import { assertAuthorizedEmailSender } from "../../../packages/shared/src/authorization.js";

export type EmailCommandKind = "start_plan" | "start_ask" | "start_direct" | "rejected" | "ignored";

export interface InboundEmailMessage {
  messageId: string;
  from: string;
  subject?: string;
  text?: string;
  receivedAt?: string;
  threadId?: string;
}

export interface EmailStartPlanCommand {
  kind: "start_plan";
  messageId: string;
  threadId: string;
  sender: string;
  repoId: string;
  prompt: string;
  replySessionId?: string;
}

export interface EmailStartAskCommand {
  kind: "start_ask";
  messageId: string;
  threadId: string;
  sender: string;
  repoId: string;
  prompt: string;
  replySessionId?: string;
}

export interface EmailStartDirectCommand {
  kind: "start_direct";
  messageId: string;
  threadId: string;
  sender: string;
  repoId: string;
  prompt: string;
  replySessionId?: string;
}

export interface EmailRejectedCommand {
  kind: "rejected";
  messageId: string;
  reason:
    | "email_disabled"
    | "sender_not_allowed"
    | "write_approval_not_supported"
    | "repo_not_configured"
    | "missing_prompt"
    | "direct_workspace_not_enabled";
}

export interface EmailIgnoredCommand {
  kind: "ignored";
  messageId: string;
  reason: "empty_message" | "unsupported";
}

export type EmailCommand = EmailStartPlanCommand | EmailStartAskCommand | EmailStartDirectCommand | EmailRejectedCommand | EmailIgnoredCommand;

export function parseInboundEmailCommand(config: HarnessConfig, message: InboundEmailMessage): EmailCommand {
  if (!config.email?.enabled) {
    return rejected(message, "email_disabled");
  }

  try {
    assertAuthorizedEmailSender(config, message.from);
  } catch {
    return rejected(message, "sender_not_allowed");
  }

  const commandText = normalizeEmailCommandText([message.subject, message.text].filter(Boolean).join("\n"));

  if (!commandText) {
    return { kind: "ignored", messageId: message.messageId, reason: "empty_message" };
  }

  const instructionText = extractEmailInstructionText(commandText);

  if (!instructionText) {
    return { kind: "ignored", messageId: message.messageId, reason: "unsupported" };
  }

  if (isWriteApprovalLike(instructionText)) {
    return rejected(message, "write_approval_not_supported");
  }

  const replySessionId = extractEmailReplySessionId(commandText);
  const repoId = extractEmailRepoId(commandText) ?? config.email.defaultRepoId ?? config.defaultRepoId;

  try {
    resolveRepoBinding(config, repoId);
  } catch {
    return rejected(message, "repo_not_configured");
  }

  const mode = extractEmailMode(instructionText);
  const prompt = extractEmailPrompt(instructionText);

  if (!prompt) {
    return rejected(message, "missing_prompt");
  }

  if (mode === "direct" && (!config.codex.directWorkspace.enabled || !config.email?.directWorkspaceEnabled)) {
    return rejected(message, "direct_workspace_not_enabled");
  }

  return {
    kind: mode === "ask" ? "start_ask" : mode === "direct" ? "start_direct" : "start_plan",
    messageId: message.messageId,
    threadId: message.threadId || message.messageId,
    sender: normalizeEmailAddress(message.from),
    repoId,
    prompt,
    replySessionId
  };
}

export function normalizeEmailCommandText(text: string): string {
  return text
    .split(/\r?\n/u)
    .filter((line) => !isQuotedEmailLine(line))
    .join("\n")
    .replace(/\r\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function extractEmailRepoId(text: string): string | undefined {
  return text.match(/\brepo:([a-zA-Z0-9._-]+)/u)?.[1];
}

export function extractEmailReplySessionId(text: string): string | undefined {
  return text.match(/\brelay:([a-zA-Z0-9_-]{6,40})\b/u)?.[1];
}

function extractEmailPrompt(text: string): string {
  return extractEmailInstructionText(text)
    .replace(/\brepo:[a-zA-Z0-9._-]+\b/gu, "")
    .replace(/\brelay:[a-zA-Z0-9_-]{6,40}\b/gu, "")
    .replace(/^codex(?: relay)?:/iu, "")
    .trim()
    .replace(/^(ask|query|question|quick|direct(?:\s+workspace)?)\b[:\s-]*/iu, "")
    .trim();
}

function extractEmailMode(text: string): "plan" | "ask" | "direct" {
  const normalized = normalizeInstructionForMode(extractEmailInstructionText(text));

  if (/^(ask|query|question)\b/u.test(normalized) || /^(what|which|where|why|how|who|when)\b/u.test(normalized)) {
    return "ask";
  }

  if (/^(quick|direct|direct workspace)\b/u.test(normalized)) {
    return "direct";
  }

  return "plan";
}

function extractEmailInstructionText(text: string): string {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => stripRelayMetadataLine(line))
    .filter(Boolean);
  const explicitCommand = lines.find((line) => isExplicitInstructionLine(line) && !isRelayGeneratedInstructionLine(line));

  if (explicitCommand) {
    return explicitCommand.trim();
  }

  if (looksLikeRelayGeneratedEmail(text)) {
    return "";
  }

  return lines.join("\n").trim();
}

function stripRelayMetadataLine(line: string): string {
  const withoutRelayMarker = line.replace(/\brelay:[a-zA-Z0-9_-]{6,40}\b/gu, "").trim();
  const withoutReplyPrefix = withoutRelayMarker.replace(/^re:\s*/iu, "").trim();

  if (
    /^codex relay (queued|completed|failed|plan ready|email request failed)\b/iu.test(withoutReplyPrefix) ||
    /^codex relay (email request rejected|smtp smoke test)\b/iu.test(withoutReplyPrefix) ||
    /^codex relay (queued|completed|failed|plan ready):/iu.test(withoutReplyPrefix) ||
    /^reply reference:\s*$/iu.test(withoutReplyPrefix) ||
    /^session:\s*[a-zA-Z0-9_-]+$/iu.test(withoutReplyPrefix) ||
    /^queue job:\s*[a-zA-Z0-9_-]+$/iu.test(withoutReplyPrefix) ||
    /^workspace:\s*(source working tree|codex\/.+)$/iu.test(withoutReplyPrefix)
  ) {
    return "";
  }

  return /^re:\s*/iu.test(withoutRelayMarker) ? withoutReplyPrefix : withoutRelayMarker;
}

function looksLikeRelayGeneratedEmail(text: string): boolean {
  return (
    /(?:^|\n)\s*(?:re:\s*)?codex relay (queued|completed|failed|plan ready|email request failed|email request rejected|smtp smoke test)\b/iu.test(text) ||
    /(?:^|\n)\s*reply reference:\s*relay:[a-zA-Z0-9_-]{6,40}\b/iu.test(text) ||
    /(?:^|\n)\s*queue job:\s*[a-zA-Z0-9_-]+/iu.test(text) ||
    /(?:^|\n)\s*session:\s*[a-zA-Z0-9_-]+/iu.test(text)
  );
}

function isExplicitInstructionLine(line: string): boolean {
  const normalized = normalizeInstructionForMode(line);

  return /^(ask|query|question|quick|direct|direct workspace)\b/u.test(normalized);
}

function isRelayGeneratedInstructionLine(line: string): boolean {
  const normalized = normalizeInstructionForMode(line);

  return (
    /^direct workspace mode\b/u.test(normalized) ||
    /^email approvals are disabled\b/u.test(normalized) ||
    /^you will receive\b/u.test(normalized) ||
    /^reply to this email\b/u.test(normalized) ||
    /^continue from the configured slack thread\b/u.test(normalized)
  );
}

function normalizeInstructionForMode(text: string): string {
  return text
    .replace(/\brepo:[a-zA-Z0-9._-]+\b/gu, "")
    .replace(/\brelay:[a-zA-Z0-9_-]{6,40}\b/gu, "")
    .replace(/^codex(?: relay)?:/iu, "")
    .trim()
    .toLowerCase();
}

function isQuotedEmailLine(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed) {
    return false;
  }

  return (
    trimmed.startsWith(">") ||
    /^on .+ wrote:$/iu.test(trimmed) ||
    /^from:\s.+/iu.test(trimmed) ||
    /^sent:\s.+/iu.test(trimmed) ||
    /^to:\s.+/iu.test(trimmed) ||
    /^subject:\s.+/iu.test(trimmed)
  );
}

function isWriteApprovalLike(text: string): boolean {
  const normalized = text.toLowerCase();

  return (
    /\b(approve|approved|execute|run|proceed)\b/u.test(normalized) &&
    /\b(plan|implementation|write|changes|patch|tests?)\b/u.test(normalized)
  );
}

function rejected(message: InboundEmailMessage, reason: EmailRejectedCommand["reason"]): EmailRejectedCommand {
  return { kind: "rejected", messageId: message.messageId, reason };
}
