import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { HarnessConfig } from "../../../packages/shared/src/config.js";
import { normalizeEmailAddress, resolveRepoBinding } from "../../../packages/shared/src/config.js";
import {
  buildEmailAskPrompt,
  buildEmailDirectWorkspacePrompt,
  buildEmailPlanPrompt
} from "../../../packages/shared/src/prompts.js";
import type {
  EmailInboundMessageRecord,
  QueueJob,
  Session,
  SlackThreadKey,
  TaskRun
} from "../../../packages/shared/src/types.js";
import { WorktreeManager } from "../../local-runner/src/worktreeManager.js";
import { getPorcelainStatus } from "../../local-runner/src/git.js";
import { enqueueEmailNotification } from "../../orchestrator/src/emailNotifications.js";
import type { InMemoryStore } from "../../orchestrator/src/persistence/inMemory.js";
import { DurableQueue } from "../../orchestrator/src/queue.js";
import { sanitizeNotificationText } from "../../orchestrator/src/slackNotifications.js";
import type { EmailCommand, InboundEmailMessage } from "./commands.js";
import { parseInboundEmailCommand } from "./commands.js";

export type ProcessInboundEmailResult =
  | {
      kind: "duplicate";
      record: EmailInboundMessageRecord;
    }
  | {
      kind: "ignored" | "rejected" | "failed";
      record: EmailInboundMessageRecord;
    }
  | {
      kind: "queued";
      record: EmailInboundMessageRecord;
      session: Session;
      taskRun: TaskRun;
      queueJob: QueueJob;
    };

export interface ProcessInboundEmailOptions {
  config: HarnessConfig;
  store: InMemoryStore;
  message: InboundEmailMessage;
  now?: Date;
}

export async function processInboundEmailMessage(
  options: ProcessInboundEmailOptions
): Promise<ProcessInboundEmailResult> {
  const now = options.now ?? new Date();
  const mailboxId = options.config.email?.mailboxId ?? "default";
  const recordId = buildInboundRecordId(mailboxId, options.message.messageId);
  const existing = options.store.getEmailInboundMessage(recordId);

  if (existing && existing.status !== "processing") {
    return { kind: "duplicate", record: existing };
  }

  const command = parseInboundEmailCommand(options.config, options.message);
  const record = existing ?? createInboundRecord({ mailboxId, message: options.message, command, now });
  record.updatedAt = now.toISOString();
  options.store.saveEmailInboundMessage(record);

  recordInboundAudit(options.store, command, record);

  if (command.kind === "ignored") {
    record.status = "ignored";
    record.reason = command.reason;
    record.processedAt = now.toISOString();
    record.updatedAt = now.toISOString();
    options.store.saveEmailInboundMessage(record);
    recordInboundAudit(options.store, command, record);
    return { kind: "ignored", record };
  }

  if (command.kind === "rejected") {
    record.status = "rejected";
    record.reason = command.reason;
    record.processedAt = now.toISOString();
    record.updatedAt = now.toISOString();
    options.store.saveEmailInboundMessage(record);
    if (shouldReplyToRejectedCommand(command)) {
      enqueueCommandRejectedReply(options.store, command, options.message, record, options.config);
    }
    recordInboundAudit(options.store, command, record);
    return { kind: "rejected", record };
  }

  try {
    const queued = await enqueueTaskForEmailCommand({
      config: options.config,
      store: options.store,
      command,
      message: options.message,
      now
    });

    record.status = "queued";
    record.reason = undefined;
    record.sessionId = queued.session.id;
    record.taskRunId = queued.taskRun.id;
    record.queueJobId = queued.queueJob.id;
    record.processedAt = now.toISOString();
    record.updatedAt = now.toISOString();
    options.store.saveEmailInboundMessage(record);
    enqueueCommandAcceptedReply(options.store, command, record, queued, options.config);
    recordInboundAudit(options.store, command, record);

    return { kind: "queued", record, ...queued };
  } catch (error) {
    record.status = "failed";
    record.error = sanitizeNotificationText(error instanceof Error ? error.message : String(error), 500);
    record.processedAt = now.toISOString();
    record.updatedAt = now.toISOString();
    options.store.saveEmailInboundMessage(record);
    enqueueCommandFailedReply(options.store, command, record, options.config);
    recordInboundAudit(options.store, command, record);
    return { kind: "failed", record };
  }
}

function createInboundRecord(input: {
  mailboxId: string;
  message: InboundEmailMessage;
  command: EmailCommand;
  now: Date;
}): EmailInboundMessageRecord {
  const now = input.now.toISOString();

  return {
    id: buildInboundRecordId(input.mailboxId, input.message.messageId),
    mailboxId: input.mailboxId,
    messageId: input.message.messageId,
    threadId: input.message.threadId || input.message.messageId,
    from: normalizeEmailAddress(input.message.from),
    subject: sanitizeSubjectForRecord(input.message.subject),
    status: "processing",
    commandKind: input.command.kind,
    receivedAt: input.message.receivedAt,
    createdAt: now,
    updatedAt: now,
    metadata: {
      hasText: Boolean(input.message.text)
    }
  };
}

async function enqueueTaskForEmailCommand(input: {
  config: HarnessConfig;
  store: InMemoryStore;
  command: Extract<EmailCommand, { kind: "start_plan" | "start_ask" | "start_direct" }>;
  message: InboundEmailMessage;
  now: Date;
}): Promise<{ session: Session; taskRun: TaskRun; queueJob: QueueJob }> {
  const repo = resolveRepoBinding(input.config, input.command.repoId);
  const threadKey = buildEmailThreadKey(input.config.email?.mailboxId ?? "default", input.command.threadId);
  const existingSession = input.command.replySessionId
    ? input.store.sessions.get(input.command.replySessionId)
    : input.store.getSessionByThread(threadKey);
  if (input.command.replySessionId && !existingSession) {
    throw new Error("No email session was found for the reply reference.");
  }
  if (existingSession?.email?.sender && normalizeEmailAddress(existingSession.email.sender) !== input.command.sender) {
    throw new Error("Email reply sender does not match the original session sender.");
  }
  const effectiveRepo = existingSession ? resolveRepoBinding(input.config, existingSession.repoId) : repo;
  const session = existingSession ?? createEmailSession({
    config: input.config,
    repoId: effectiveRepo.id,
    sourceRepoPath: effectiveRepo.path,
    threadKey,
    command: input.command,
    now: input.now
  });

  if (hasActiveRun(input.store, session.id) || hasActiveQueuedJob(input.store, session.id)) {
    throw new Error("A Codex run is already active or queued for this email thread.");
  }

  if (input.command.kind !== "start_ask" && hasPendingApproval(input.store, session.id)) {
    throw new Error("A plan is already awaiting Slack approval for this email thread.");
  }

  if (input.command.kind === "start_direct") {
    if (existingSession?.workspaceKind === "worktree") {
      throw new Error("Email direct workspace mode cannot continue an isolated worktree session. Start a new email with repo:<id> direct ...");
    }

    await assertEmailDirectWorkspaceAllowed(input.config, effectiveRepo.id, effectiveRepo.path);
    session.workspacePath = effectiveRepo.path;
    session.sourceRepoPath = effectiveRepo.path;
    session.workspaceKind = "source";
  } else if (input.command.kind === "start_ask" && !existingSession) {
    session.workspacePath = effectiveRepo.path;
    session.sourceRepoPath = effectiveRepo.path;
    session.workspaceKind = "source";
  } else if (!session.workspacePath || session.workspaceKind !== "worktree") {
    const worktrees = new WorktreeManager(input.config.codex.worktreeRoot);
    const worktree = await worktrees.createWorktree({
      sessionId: session.id,
      repo: effectiveRepo,
      branchName: session.branchName
    });
    session.workspacePath = worktree.workspacePath;
    session.sourceRepoPath = worktree.sourceRepoPath;
    session.branchName = worktree.branchName;
    session.workspaceKind = "worktree";
  }

  input.store.saveSession(session);

  const taskRun = createQueuedEmailRun({
    sessionId: session.id,
    commandKind: input.command.kind,
    prompt: buildEmailPromptForCommand({
      config: input.config,
      command: input.command,
      message: input.message,
      repoId: effectiveRepo.id
    })
  });
  input.store.saveTaskRun(taskRun);

  const queue = new DurableQueue(input.store);
  const queueJob = queue.enqueueRunnerTask({
    repoId: effectiveRepo.id,
    task: {
      runId: taskRun.id,
      sessionId: session.id,
      mode: taskRun.mode,
      prompt: taskRun.prompt,
      workspacePath: session.workspacePath,
      sandbox: taskRun.sandbox,
      approvalPolicy: taskRun.approvalPolicy,
      model: input.config.codex.model,
      codexSessionId: session.codexSessionId
    },
    now: input.now
  });

  input.store.saveAuditEvent({
    id: nanoid(12),
    at: input.now.toISOString(),
    type: "queue.enqueued",
    outcome: "info",
    summary: "Email runner task enqueued.",
    repoId: effectiveRepo.id,
    sessionId: session.id,
    taskRunId: taskRun.id,
    metadata: {
      queueJobId: queueJob.id,
      source: "email",
      mailboxId: input.config.email?.mailboxId ?? "default",
      commandKind: input.command.kind,
      workspaceKind: session.workspaceKind
    }
  });

  return { session, taskRun, queueJob };
}

function createEmailSession(input: {
  config: HarnessConfig;
  repoId: string;
  sourceRepoPath: string;
  threadKey: SlackThreadKey;
  command: Extract<EmailCommand, { kind: "start_plan" | "start_ask" | "start_direct" }>;
  now: Date;
}): Session {
  const id = nanoid(12);
  const mailboxId = input.config.email?.mailboxId ?? "default";

  return {
    id,
    controlPlane: "email",
    slackThreadKey: input.threadKey,
    ownerSlackUserId: `email:${input.command.sender}`,
    repoId: input.repoId,
    sourceRepoPath: input.sourceRepoPath,
    workspacePath: "",
    workspaceKind: "worktree",
    branchName: buildEmailBranchName(input.command.threadId, id),
    runnerKind: "exec",
    status: "idle",
    email: {
      mailboxId,
      threadId: input.command.threadId,
      sender: input.command.sender,
      firstMessageId: input.command.messageId
    },
    createdAt: input.now.toISOString(),
    updatedAt: input.now.toISOString()
  };
}

function createQueuedEmailRun(input: {
  sessionId: string;
  commandKind: "start_plan" | "start_ask" | "start_direct";
  prompt: string;
}): TaskRun {
  return {
    id: nanoid(12),
    sessionId: input.sessionId,
    mode: input.commandKind === "start_ask" ? "explain" : input.commandKind === "start_direct" ? "implement" : "plan",
    prompt: input.prompt,
    status: "queued",
    sandbox: input.commandKind === "start_direct" ? "workspace-write" : "read-only",
    approvalPolicy: "never"
  };
}

function buildEmailPromptForCommand(input: {
  config: HarnessConfig;
  command: Extract<EmailCommand, { kind: "start_plan" | "start_ask" | "start_direct" }>;
  message: InboundEmailMessage;
  repoId: string;
}): string {
  const base = {
    repoId: input.repoId,
    requester: input.command.sender,
    mailboxId: input.config.email?.mailboxId ?? "default",
    messageId: input.command.messageId,
    subject: input.message.subject,
    text: input.command.prompt
  };

  if (input.command.kind === "start_ask") {
    return buildEmailAskPrompt(base);
  }

  if (input.command.kind === "start_direct") {
    return buildEmailDirectWorkspacePrompt(base);
  }

  return buildEmailPlanPrompt(base);
}

function enqueueCommandAcceptedReply(
  store: InMemoryStore,
  command: Extract<EmailCommand, { kind: "start_plan" | "start_ask" | "start_direct" }>,
  record: EmailInboundMessageRecord,
  queued: { session: Session; taskRun: TaskRun; queueJob: QueueJob },
  config: HarnessConfig
): void {
  const label =
    command.kind === "start_ask"
      ? "read-only ask"
      : command.kind === "start_direct"
        ? "direct workspace"
        : "read-only plan";
  const completionNote =
    command.kind === "start_plan"
      ? "Email approvals are disabled. You will receive a compact plan-ready reply when the runner finishes."
      : command.kind === "start_ask"
        ? "You will receive a compact answer reply when the runner finishes."
        : "Direct workspace mode edits the source working tree. You will receive a compact completion reply.";

  enqueueEmailNotification(store, {
    kind: "email.command_accepted",
    severity: "info",
    to: [command.sender],
    subject: `Codex Relay queued: ${command.repoId} [relay:${queued.session.id}]`,
    text: [
      `Codex Relay queued your ${label} request.`,
      "",
      `Repo: ${command.repoId}`,
      `Workspace: ${queued.session.workspaceKind === "source" ? "source working tree" : queued.session.branchName}`,
      `Session: ${queued.session.id}`,
      `Reply reference: relay:${queued.session.id}`,
      `Queue job: ${queued.queueJob.id}`,
      "",
      completionNote
    ].join("\n"),
    sessionId: queued.session.id,
    repoId: command.repoId,
    taskRunId: queued.taskRun.id,
    queueJobId: queued.queueJob.id,
    metadata: {
      emailInboundId: record.id,
      mailboxId: config.email?.mailboxId ?? "default"
    }
  });
}

function enqueueCommandRejectedReply(
  store: InMemoryStore,
  command: Extract<EmailCommand, { kind: "rejected" }>,
  message: InboundEmailMessage,
  record: EmailInboundMessageRecord,
  config: HarnessConfig
): void {
  enqueueEmailNotification(store, {
    kind: "email.command_rejected",
    severity: "failure",
    to: [normalizeEmailAddress(message.from)],
    subject: "Codex Relay email request rejected",
    text: [
      "Codex Relay rejected this email request.",
      "",
      `Reason: ${command.reason}`,
      "",
      "Only allowlisted senders can start email tasks. Ask/query is read-only. Direct workspace mode is disabled unless explicitly enabled."
    ].join("\n"),
    metadata: {
      emailInboundId: record.id,
      mailboxId: config.email?.mailboxId ?? "default",
      reason: command.reason
    }
  });
}

function shouldReplyToRejectedCommand(command: Extract<EmailCommand, { kind: "rejected" }>): boolean {
  return command.reason !== "sender_not_allowed" && command.reason !== "email_disabled";
}

function enqueueCommandFailedReply(
  store: InMemoryStore,
  command: Extract<EmailCommand, { kind: "start_plan" | "start_ask" | "start_direct" }>,
  record: EmailInboundMessageRecord,
  config: HarnessConfig
): void {
  enqueueEmailNotification(store, {
    kind: "email.command_failed",
    severity: "failure",
    to: [command.sender],
    subject: `Codex Relay email request failed: ${command.repoId}`,
    text: [
      "Codex Relay could not queue this email request.",
      "",
      `Repo: ${command.repoId}`,
      `Reason: ${record.error ?? "Unknown error."}`
    ].join("\n"),
    repoId: command.repoId,
    metadata: {
      emailInboundId: record.id,
      mailboxId: config.email?.mailboxId ?? "default"
    }
  });
}

function recordInboundAudit(store: InMemoryStore, command: EmailCommand, record: EmailInboundMessageRecord): void {
  const type =
    record.status === "queued"
      ? "email.command_queued"
      : record.status === "rejected"
        ? "email.command_rejected"
        : record.status === "ignored"
          ? "email.command_ignored"
          : record.status === "failed"
            ? "email.command_failed"
            : "email.command_received";
  const outcome =
    record.status === "queued"
      ? "success"
      : record.status === "rejected"
        ? "denied"
        : record.status === "failed"
          ? "failure"
          : "info";

  store.saveAuditEvent({
    id: nanoid(12),
    at: new Date().toISOString(),
    type,
    outcome,
    summary: emailAuditSummary(record.status),
    repoId:
      command.kind === "start_plan" || command.kind === "start_ask" || command.kind === "start_direct"
        ? command.repoId
        : undefined,
    sessionId: record.sessionId,
    taskRunId: record.taskRunId,
    metadata: {
      emailInboundId: record.id,
      mailboxId: record.mailboxId,
      messageIdHash: hashForAudit(record.messageId),
      commandKind: command.kind,
      reason: record.reason ?? null
    }
  });
}

function emailAuditSummary(status: EmailInboundMessageRecord["status"]): string {
  if (status === "queued") {
    return "Email command queued a runner task.";
  }

  if (status === "rejected") {
    return "Email command rejected.";
  }

  if (status === "ignored") {
    return "Email command ignored.";
  }

  if (status === "failed") {
    return "Email command failed.";
  }

  return "Email command received.";
}

function hasActiveRun(store: InMemoryStore, sessionId: string): boolean {
  return [...store.taskRuns.values()].some((run) => run.sessionId === sessionId && store.activeRuns.has(run.id));
}

function hasActiveQueuedJob(store: InMemoryStore, sessionId: string): boolean {
  return store
    .listQueueJobs()
    .some((job) => job.sessionId === sessionId && (job.status === "queued" || job.status === "leased"));
}

function hasPendingApproval(store: InMemoryStore, sessionId: string): boolean {
  return [...store.approvals.values()].some((approval) => approval.sessionId === sessionId && approval.status === "pending");
}

async function assertEmailDirectWorkspaceAllowed(config: HarnessConfig, repoId: string, repoPath: string): Promise<void> {
  const direct = config.codex.directWorkspace;

  if (!direct.enabled) {
    throw new Error("Direct workspace mode is disabled.");
  }

  if (!config.email?.directWorkspaceEnabled) {
    throw new Error("Email direct workspace mode is disabled.");
  }

  if (!direct.allowedRepoIds.includes(repoId)) {
    throw new Error(`Direct workspace mode is not allowlisted for repo:${repoId}.`);
  }

  if (direct.requireClean) {
    const status = await getPorcelainStatus(repoPath);

    if (status) {
      throw new Error("Direct workspace mode requires a clean git working tree.");
    }
  }
}

function buildInboundRecordId(mailboxId: string, messageId: string): string {
  return `${sanitizeIdPart(mailboxId)}:${hashForAudit(messageId)}`;
}

function buildEmailThreadKey(mailboxId: string, threadId: string): SlackThreadKey {
  return `email:${sanitizeIdPart(mailboxId)}:${hashForAudit(threadId)}` as SlackThreadKey;
}

function buildEmailBranchName(threadId: string, sessionId: string): string {
  return `codex/email/${hashForAudit(threadId).slice(0, 16)}-${sessionId.slice(0, 8)}`;
}

function hashForAudit(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^0-9A-Za-z._-]/gu, "-").slice(0, 48) || "default";
}

function sanitizeSubjectForRecord(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return sanitizeNotificationText(value, 160);
}
