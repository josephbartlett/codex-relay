import { pathToFileURL } from "node:url";
import type { EmailControlPlaneConfig } from "../../../packages/shared/src/config.js";
import { loadConfig } from "../../../packages/shared/src/config.js";
import { createLogger, type Logger } from "../../../packages/shared/src/logging.js";
import type {
  AuditEvent,
  ApprovalRequest,
  QueueClaim,
  QueueJob,
  RunnerAdapter,
  RunnerEventSink,
  RunnerResult,
  Session
} from "../../../packages/shared/src/types.js";
import { DurableQueue, QueueLeaseExpiredError } from "../../orchestrator/src/queue.js";
import type { InMemoryStore } from "../../orchestrator/src/persistence/inMemory.js";
import { loadConfiguredStore } from "../../orchestrator/src/persistence/storeFactory.js";
import { touchSession } from "../../orchestrator/src/sessions.js";
import { ExecAdapter } from "../../orchestrator/src/runner/ExecAdapter.js";
import { nanoid } from "nanoid";
import { runStartupChecks } from "./startupChecks.js";
import { createExecutionApproval } from "../../orchestrator/src/approvals.js";
import { enqueueSlackNotification, sanitizeNotificationText } from "../../orchestrator/src/slackNotifications.js";
import { enqueueEmailNotification } from "../../orchestrator/src/emailNotifications.js";

export interface RunnerDaemonOptions {
  store: InMemoryStore;
  runner: RunnerAdapter;
  queue?: DurableQueue;
  runnerId?: string;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  now?: () => Date;
  sink?: RunnerEventSink;
  logger?: Logger;
  emailConfig?: EmailControlPlaneConfig;
}

export interface RunnerDaemonOnceResult {
  claimed: boolean;
  claim?: QueueClaim;
  finalJob?: QueueJob;
  runnerResult?: RunnerResult;
}

const defaultRunnerId = `runner-${process.pid}`;
const defaultHeartbeatIntervalMs = 15_000;
const defaultPollIntervalMs = 2_000;

export async function runRunnerDaemonOnce(options: RunnerDaemonOptions): Promise<RunnerDaemonOnceResult> {
  const queue = options.queue ?? new DurableQueue(options.store);
  const runnerId = options.runnerId ?? defaultRunnerId;
  const now = options.now ?? (() => new Date());
  const claim = queue.claimNext({ runnerId, now: now() });

  if (!claim) {
    return { claimed: false };
  }

  options.logger?.info("Runner claimed queue job.", {
    queueJobId: claim.job.id,
    taskRunId: claim.job.taskRunId,
    sessionId: claim.job.sessionId,
    runnerId
  });
  recordQueueAudit(options.store, {
    type: "queue.claimed",
    outcome: "info",
    summary: "Runner claimed queue job.",
    job: claim.job,
    runnerId,
    leaseId: claim.lease.id
  });
  enqueueRunnerStartedNotification(options.store, claim.job, runnerId);
  markTaskRunRunning(options.store, claim.job);

  let handle: ReturnType<RunnerAdapter["start"]>;

  try {
    handle = options.runner.start(claim.job.payload, options.sink);
  } catch (error) {
    const runnerResult = failedRunnerResult(claim, error);
    const finalJob = settleRunnerResult({ ...options, queue, claim, runnerId, now, runnerResult });
    updateTaskRunAndSession(options.store, finalJob, runnerResult);
    recordFinalQueueAudit(options.store, finalJob, runnerId, claim.lease.id, runnerResult);
    enqueueFinalRunnerNotification(options.store, finalJob, runnerResult, options.emailConfig);
    return { claimed: true, claim, finalJob, runnerResult };
  }

  let heartbeat: ReturnType<typeof setInterval> | undefined;

  if (options.heartbeatIntervalMs !== 0) {
    heartbeat = setInterval(() => {
      try {
        queue.heartbeat({
          jobId: claim.job.id,
          leaseId: claim.lease.id,
          runnerId,
          now: now()
        });
      } catch (error) {
        options.logger?.warn("Runner heartbeat failed.", {
          queueJobId: claim.job.id,
          runnerId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, options.heartbeatIntervalMs ?? defaultHeartbeatIntervalMs);
  }

  const runnerResult = await handle.promise.catch((error: unknown) => failedRunnerResult(claim, error));
  clearHeartbeat(heartbeat);
  const finalJob = settleRunnerResult({ ...options, queue, claim, runnerId, now, runnerResult });
  updateTaskRunAndSession(options.store, finalJob, runnerResult);
  recordFinalQueueAudit(options.store, finalJob, runnerId, claim.lease.id, runnerResult);
  enqueueFinalRunnerNotification(options.store, finalJob, runnerResult, options.emailConfig);

  return { claimed: true, claim, finalJob, runnerResult };
}

export async function runRunnerDaemonLoop(
  options: RunnerDaemonOptions & { signal?: AbortSignal }
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;

  while (!options.signal?.aborted) {
    const result = await runRunnerDaemonOnce(options);

    if (!result.claimed) {
      await sleep(pollIntervalMs, options.signal);
    }
  }
}

function clearHeartbeat(heartbeat: ReturnType<typeof setInterval> | undefined): void {
  if (heartbeat) {
    clearInterval(heartbeat);
  }
}

function failedRunnerResult(claim: QueueClaim, error: unknown): RunnerResult {
  const message = error instanceof Error ? error.message : String(error);

  return {
    runId: claim.job.payload.runId,
    status: "failed",
    finalMessage: message,
    stdout: "",
    stderr: message,
    exitCode: null
  };
}

function settleRunnerResult(input: RunnerDaemonOptions & {
  queue: DurableQueue;
  claim: QueueClaim;
  runnerId: string;
  now: () => Date;
  runnerResult: RunnerResult;
}): QueueJob {
  try {
    if (input.runnerResult.status === "completed") {
      return input.queue.complete({
        jobId: input.claim.job.id,
        leaseId: input.claim.lease.id,
        runnerId: input.runnerId,
        now: input.now()
      });
    }

    return input.queue.fail({
      jobId: input.claim.job.id,
      leaseId: input.claim.lease.id,
      runnerId: input.runnerId,
      now: input.now(),
      error: input.runnerResult.stderr || input.runnerResult.finalMessage || `Runner ${input.runnerResult.status}.`,
      retry: input.runnerResult.status !== "cancelled"
    });
  } catch (error) {
    const currentJob = input.store.getQueueJob(input.claim.job.id);

    if (!(error instanceof QueueLeaseExpiredError)) {
      if (currentJob) {
        input.logger?.warn("Runner result could not mutate queue job; preserving current queue state.", {
          queueJobId: input.claim.job.id,
          runnerId: input.runnerId,
          status: currentJob.status,
          error: error instanceof Error ? error.message : String(error)
        });
        return currentJob;
      }

      throw error;
    }

    input.logger?.warn("Runner result arrived after lease expiry; recovering queue job instead of accepting stale result.", {
      queueJobId: input.claim.job.id,
      runnerId: input.runnerId
    });
    input.queue.recoverAbandonedLeases({ now: input.now() });

    const recoveredJob = input.store.getQueueJob(input.claim.job.id);

    if (!recoveredJob) {
      throw error;
    }

    return recoveredJob;
  }
}

function markTaskRunRunning(store: InMemoryStore, job: QueueJob): void {
  const taskRun = job.taskRunId ? store.taskRuns.get(job.taskRunId) : undefined;

  if (taskRun && taskRun.status === "queued") {
    taskRun.status = "running";
    taskRun.startedAt = new Date().toISOString();
    store.saveTaskRun(taskRun);
  }

  const session = store.sessions.get(job.sessionId);

  if (!session) {
    return;
  }

  touchSession(session, job.payload.mode === "plan" ? "planning" : "running");
  store.saveSession(session);
}

function updateTaskRunAndSession(store: InMemoryStore, job: QueueJob, result: RunnerResult): void {
  const taskRun = job.taskRunId ? store.taskRuns.get(job.taskRunId) : undefined;

  if (taskRun) {
    if (job.status === "queued") {
      taskRun.status = "queued";
      taskRun.completedAt = undefined;
    } else if (job.status === "leased") {
      return;
    } else if (job.status === "completed" && job.payload.mode === "plan" && result.status === "completed") {
      taskRun.status = "awaiting_approval";
      taskRun.completedAt = new Date().toISOString();
    } else {
      taskRun.status = result.status;
      taskRun.completedAt = new Date().toISOString();
    }

    taskRun.resultSummary = result.finalMessage;
    taskRun.error = result.status === "completed" ? undefined : result.stderr || result.finalMessage;
    store.saveTaskRun(taskRun);
  }

  const session = store.sessions.get(job.sessionId);

  if (!session) {
    return;
  }

  if (result.codexSessionId) {
    session.codexSessionId = result.codexSessionId;
  }

  if (job.status === "queued") {
    touchSession(session, job.payload.mode === "plan" ? "planning" : "running");
  } else if (job.status === "completed" && job.payload.mode === "plan" && result.status === "completed") {
    createPlanApprovalIfMissing(store, job, result.finalMessage);
    touchSession(session, "awaiting_approval");
  } else if (job.status === "completed" && job.payload.mode !== "plan") {
    touchSession(session, "done");
  } else if (job.status === "failed" || result.status === "failed") {
    touchSession(session, "failed");
  } else if (job.status === "cancelled" || result.status === "cancelled") {
    touchSession(session, "cancelled");
  }

  store.saveSession(session);
}

function createPlanApprovalIfMissing(store: InMemoryStore, job: QueueJob, summary: string): ApprovalRequest | undefined {
  const taskRun = job.taskRunId ? store.taskRuns.get(job.taskRunId) : undefined;
  const session = store.sessions.get(job.sessionId);

  if (!taskRun || !session) {
    return undefined;
  }

  const existing = [...store.approvals.values()].find((approval) => approval.taskRunId === taskRun.id);

  if (existing) {
    return existing;
  }

  const approval = createExecutionApproval({
    taskRun,
    requestedBySlackUserId: session.ownerSlackUserId,
    summary
  });
  store.saveApproval(approval);
  store.saveAuditEvent({
    id: nanoid(12),
    at: new Date().toISOString(),
    type: "approval.created",
    outcome: "info",
    summary: "Execution approval requested.",
    actorSlackUserId: session.ownerSlackUserId,
    slackThreadKey: session.slackThreadKey,
    repoId: session.repoId,
    sessionId: session.id,
    taskRunId: taskRun.id,
    approvalId: approval.id,
    metadata: {
      queueJobId: job.id
    }
  });

  return approval;
}

function enqueueRunnerStartedNotification(store: InMemoryStore, job: QueueJob, runnerId: string): void {
  const session = store.sessions.get(job.sessionId);

  if (!session || session.controlPlane === "email") {
    return;
  }

  enqueueSlackNotification(store, {
    kind: "runner.started",
    severity: "info",
    slackThreadKey: session.slackThreadKey,
    sessionId: session.id,
    repoId: session.repoId,
    taskRunId: job.taskRunId,
    queueJobId: job.id,
    title: "Queued task running",
    detail: [
      `Mode: ${job.payload.mode}`,
      `Repo: ${session.repoId}`,
      `Branch: ${session.branchName}`,
      `Runner: ${runnerId}`
    ].join("\n"),
    metadata: {
      queueJobId: job.id,
      runnerId,
      attempts: job.attempts
    }
  });
}

function enqueueFinalRunnerNotification(
  store: InMemoryStore,
  job: QueueJob,
  result: RunnerResult,
  emailConfig?: EmailControlPlaneConfig
): void {
  const session = store.sessions.get(job.sessionId);

  if (!session || job.status === "queued" || job.status === "leased") {
    return;
  }

  const notifySlack = session.controlPlane !== "email";

  if (job.status === "completed" && job.payload.mode === "plan" && result.status === "completed") {
    const approval = job.taskRunId
      ? [...store.approvals.values()].find((candidate) => candidate.taskRunId === job.taskRunId)
      : undefined;

    if (!approval) {
      return;
    }

    if (notifySlack) {
      enqueueSlackNotification(store, {
        kind: "plan.ready",
        severity: "success",
        slackThreadKey: session.slackThreadKey,
        sessionId: session.id,
        repoId: session.repoId,
        taskRunId: job.taskRunId,
        approvalId: approval.id,
        queueJobId: job.id,
        title: "Plan ready",
        detail: approval.summary,
        metadata: {
          queueJobId: job.id,
          approvalId: approval.id
        }
      });
    }
    enqueuePlanReadyEmailNotification(store, job, session, approval.summary, emailConfig, approval.id);
    return;
  }

  if (job.status === "completed" && result.status === "completed") {
    if (notifySlack) {
      enqueueSlackNotification(store, {
        kind: "runner.completed",
        severity: "success",
        slackThreadKey: session.slackThreadKey,
        sessionId: session.id,
        repoId: session.repoId,
        taskRunId: job.taskRunId,
        queueJobId: job.id,
        title: "Queued task completed",
        detail: [
          `Mode: ${job.payload.mode}`,
          `Repo: ${session.repoId}`,
          `Branch: ${session.branchName}`,
          `Summary: ${sanitizeNotificationText(result.finalMessage || "Completed.", 800)}`
        ].join("\n"),
        metadata: {
          queueJobId: job.id,
          runnerStatus: result.status
        }
      });
    }
    enqueueRunnerEmailNotification(store, job, session, result, emailConfig, "runner.completed");
    return;
  }

  if (notifySlack) {
    enqueueSlackNotification(store, {
      kind: "runner.failed",
      severity: "failure",
      slackThreadKey: session.slackThreadKey,
      sessionId: session.id,
      repoId: session.repoId,
      taskRunId: job.taskRunId,
      queueJobId: job.id,
      title: "Queued task failed",
      detail: [
        `Mode: ${job.payload.mode}`,
        `Repo: ${session.repoId}`,
        `Branch: ${session.branchName}`,
        `Error: ${sanitizeNotificationText(result.stderr || result.finalMessage || job.error || "Runner failed.", 800)}`
      ].join("\n"),
      metadata: {
        queueJobId: job.id,
        runnerStatus: result.status,
        queueStatus: job.status
      }
    });
  }
  enqueueRunnerEmailNotification(store, job, session, result, emailConfig, "runner.failed");
}

function enqueuePlanReadyEmailNotification(
  store: InMemoryStore,
  job: QueueJob,
  session: Session,
  summary: string,
  emailConfig: EmailControlPlaneConfig | undefined,
  approvalId: string
): void {
  const recipients = emailRecipientsForSession(session, emailConfig);

  if (!emailConfig?.smtp.enabled || recipients.length === 0) {
    return;
  }

  const notification = enqueueEmailNotification(store, {
    kind: "plan.ready",
    severity: "success",
    to: recipients,
    subject: `Codex Relay plan ready: ${session.repoId} [relay:${session.id}]`,
    text: [
      "Codex Relay plan ready.",
      "",
      `Repo: ${session.repoId}`,
      `Branch: ${session.branchName}`,
      `Reply reference: relay:${session.id}`,
      "",
      sanitizeNotificationText(summary, 2000),
      "",
      session.controlPlane === "email"
        ? "Reply to this email with a follow-up question or next plan request. Email approvals are disabled."
        : "Reply to this email with a follow-up question, or approve execution from the configured Slack thread."
    ].join("\n"),
    sessionId: session.id,
    repoId: session.repoId,
    taskRunId: job.taskRunId,
    approvalId,
    queueJobId: job.id,
    metadata: {
      source: "runner-daemon"
    }
  });
  recordEmailEnqueuedAudit(store, notification.id, session.id, session.repoId);
}

function enqueueRunnerEmailNotification(
  store: InMemoryStore,
  job: QueueJob,
  session: Session,
  result: RunnerResult,
  emailConfig: EmailControlPlaneConfig | undefined,
  kind: "runner.completed" | "runner.failed"
): void {
  const recipients = emailRecipientsForSession(session, emailConfig);

  if (!emailConfig?.smtp.enabled || recipients.length === 0) {
    return;
  }

  const completed = kind === "runner.completed";
  const notification = enqueueEmailNotification(store, {
    kind,
    severity: completed ? "success" : "failure",
    to: recipients,
    subject: completed
      ? `Codex Relay completed: ${session.repoId} [relay:${session.id}]`
      : `Codex Relay failed: ${session.repoId} [relay:${session.id}]`,
    text: [
      completed ? "Codex Relay task completed." : "Codex Relay task failed.",
      "",
      `Mode: ${job.payload.mode}`,
      `Repo: ${session.repoId}`,
      `Branch: ${session.branchName}`,
      `Reply reference: relay:${session.id}`,
      "",
      completed ? "Summary:" : "Error:",
      sanitizeNotificationText(result.finalMessage || result.stderr || job.error || "No summary provided.", 2000),
      "",
      session.controlPlane === "email"
        ? "Reply to this email to continue the session. Use ask/query for read-only questions. Email replies cannot approve write execution."
        : "Continue from the configured Slack thread, or reply with ask/query for a read-only follow-up."
    ].join("\n"),
    sessionId: session.id,
    repoId: session.repoId,
    taskRunId: job.taskRunId,
    queueJobId: job.id,
    metadata: {
      source: "runner-daemon",
      runnerStatus: result.status,
      queueStatus: job.status
    }
  });
  recordEmailEnqueuedAudit(store, notification.id, session.id, session.repoId);
}

function emailRecipientsForSession(session: Session, emailConfig: EmailControlPlaneConfig | undefined): string[] {
  if (!emailConfig?.smtp.enabled) {
    return [];
  }

  if (session.controlPlane === "email" && session.email?.sender) {
    return [session.email.sender];
  }

  return emailConfig.smtp.recipients;
}

function recordEmailEnqueuedAudit(
  store: InMemoryStore,
  emailNotificationId: string,
  sessionId: string,
  repoId: string
): void {
  store.saveAuditEvent({
    id: nanoid(12),
    at: new Date().toISOString(),
    type: "email.notification_enqueued",
    outcome: "info",
    summary: "Email notification enqueued.",
    repoId,
    sessionId,
    metadata: {
      emailNotificationId
    }
  });
}

function recordFinalQueueAudit(
  store: InMemoryStore,
  job: QueueJob,
  runnerId: string,
  leaseId: string,
  runnerResult: RunnerResult
): void {
  const completed = job.status === "completed";

  recordQueueAudit(store, {
    type: completed ? "queue.completed" : "queue.failed",
    outcome: completed ? "success" : "failure",
    summary: completed ? "Runner queue job completed." : "Runner queue job did not complete.",
    job,
    runnerId,
    leaseId,
    runnerStatus: runnerResult.status
  });
}

function recordQueueAudit(
  store: InMemoryStore,
  input: {
    type: AuditEvent["type"];
    outcome: AuditEvent["outcome"];
    summary: string;
    job: QueueJob;
    runnerId: string;
    leaseId: string;
    runnerStatus?: RunnerResult["status"];
  }
): void {
  store.saveAuditEvent({
    id: nanoid(12),
    at: new Date().toISOString(),
    type: input.type,
    outcome: input.outcome,
    summary: input.summary,
    repoId: input.job.repoId,
    sessionId: input.job.sessionId,
    taskRunId: input.job.taskRunId,
    metadata: {
      queueJobId: input.job.id,
      leaseId: input.leaseId,
      runnerId: input.runnerId,
      attempts: input.job.attempts,
      status: input.job.status,
      runnerStatus: input.runnerStatus ?? null
    }
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

async function main(): Promise<void> {
  const logger = createLogger("local-runner");
  const config = loadConfig(process.env, { requireSlack: false });
  const startup = await runStartupChecks(config);

  for (const warning of startup.warnings) {
    logger.warn(warning);
  }

  if (startup.failures.length > 0) {
    for (const failure of startup.failures) {
      logger.error(failure);
    }

    throw new Error("Local runner startup checks failed.");
  }

  const store = loadConfiguredStore(config);
  const runner = new ExecAdapter({
    command: config.codex.command,
    model: config.codex.model,
    envAllowlist: config.codex.runnerEnvAllowlist
  });

  logger.info("Local runner daemon started.", {
    runnerId: defaultRunnerId,
    storeKind: config.codex.storeKind
  });
  await runRunnerDaemonLoop({ store, runner, logger, emailConfig: config.email });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
