import { nanoid } from "nanoid";
import {
  authorizeSlackAction,
  AuthorizationError,
  isSlackMaintainer,
  type AuthorizationAction,
  type AuthorizationInput
} from "../../../packages/shared/src/authorization.js";
import type { HarnessConfig } from "../../../packages/shared/src/config.js";
import { resolveRepoBinding } from "../../../packages/shared/src/config.js";
import {
  buildFollowUpPlanPrompt,
  buildImplementPrompt,
  buildLocalHandoffPrompt,
  buildPlanPrompt,
  buildTestPlanPrompt,
  buildTestRunPrompt
} from "../../../packages/shared/src/prompts.js";
import type {
  ApprovalRequest,
  ApprovalType,
  AuditEvent,
  AuditEventType,
  AuditOutcome,
  QueueJob,
  RunnerAdapter,
  RunnerEventSink,
  RunnerResult,
  Session,
  SlackTaskContext,
  TaskRun,
  DraftPullRequestLifecycleResult,
  DraftPullRequestReadyResult,
  DraftPullRequestResult,
  DraftPullRequestStatus
} from "../../../packages/shared/src/types.js";
import {
  buildPullRequestBody,
  buildPullRequestTitle,
  createDraftPullRequest,
  getDraftPullRequestStatus,
  markDraftPullRequestReadyForReview,
  type DraftPullRequestInput,
  type MarkDraftPullRequestReadyInput,
  type DraftPullRequestStatusInput
} from "../../local-runner/src/pullRequest.js";
import { getChangedFilesSince } from "../../local-runner/src/git.js";
import { WorktreeManager } from "../../local-runner/src/worktreeManager.js";
import { createExecutionApproval, isExpired } from "./approvals.js";
import { collectDiffSummary, type DiffSummary } from "./artifacts.js";
import {
  classifyFollowUpIntent,
  extractRepoId,
  normalizeFollowUpText,
  type FollowUpIntent
} from "./context.js";
import type { InMemoryStore } from "./persistence/inMemory.js";
import { DurableQueue } from "./queue.js";
import { getOrCreateSession, touchSession } from "./sessions.js";

export interface PlanTaskResult {
  approval: ApprovalRequest;
  planRun: TaskRun;
  runnerResult: RunnerResult;
}

export interface ExecuteTaskResult {
  implementRun: TaskRun;
  runnerResult: RunnerResult;
  diff: DiffSummary;
}

export type FollowUpResult =
  | {
      kind: "plan";
      intent: Extract<FollowUpIntent, "new_task" | "continue" | "revise_plan" | "run_tests">;
      approval: ApprovalRequest;
      planRun: TaskRun;
      runnerResult: RunnerResult;
      supersededApprovalIds: string[];
    }
  | {
      kind: "diff";
      intent: "summarize_diff";
      session: Session;
      diff: DiffSummary;
    }
  | {
      kind: "pull_request";
      intent: "update_pr";
      session: Session;
      lifecycle: DraftPullRequestLifecycleResult;
    }
  | {
      kind: "pr_ready";
      intent: "ready_for_review";
      session: Session;
      ready: DraftPullRequestReadyResult;
    }
  | {
      kind: "cancel";
      intent: "cancel";
      sessionId: string;
      cancelledRunIds: string[];
      rejectedApprovalIds: string[];
    }
  | {
      kind: "guidance";
      intent: Exclude<FollowUpIntent, "new_task" | "continue" | "revise_plan" | "run_tests" | "summarize_diff" | "cancel">;
      message: string;
      session?: Session;
    };

export interface CleanupWorktreesResult {
  dryRun: boolean;
  policy: CleanupWorktreesPolicySummary;
  inspected: number;
  removed: Array<{ sessionId: string; workspacePath: string }>;
  skipped: Array<{ sessionId: string; workspacePath: string; reason: string }>;
}

export interface CleanupWorktreesPolicySummary {
  olderThanDays: number;
  eligibleStatuses: string[];
  completedSessionRequiresDraftPullRequest: boolean;
  removesDirtyWorktrees: boolean;
}

export interface EnqueueRunnerTaskForSessionResult {
  taskRun: TaskRun;
  job: QueueJob;
}

export interface EnqueueLocalHandoffResult extends EnqueueRunnerTaskForSessionResult {
  session: Session;
}

type DraftPullRequestCreator = (input: DraftPullRequestInput) => Promise<DraftPullRequestResult>;
type DraftPullRequestStatusReader = (input: DraftPullRequestStatusInput) => Promise<DraftPullRequestStatus>;
type DraftPullRequestReadyMarker = (input: MarkDraftPullRequestReadyInput) => Promise<DraftPullRequestReadyResult>;

interface StartPlanOptions {
  approvalType?: Extract<ApprovalType, "execute_plan" | "run_tests">;
  promptKind?: "initial" | "follow_up" | "test_plan";
  followUpIntent?: Extract<FollowUpIntent, "continue" | "revise_plan">;
  supersedePendingApprovals?: boolean;
}

export class Orchestrator {
  private readonly worktrees: WorktreeManager;

  constructor(
    private readonly config: HarnessConfig,
    private readonly store: InMemoryStore,
    private readonly runner: RunnerAdapter,
    private readonly draftPullRequestCreator: DraftPullRequestCreator = createDraftPullRequest,
    private readonly draftPullRequestStatusReader: DraftPullRequestStatusReader = getDraftPullRequestStatus,
    private readonly draftPullRequestReadyMarker: DraftPullRequestReadyMarker = markDraftPullRequestReadyForReview
  ) {
    this.worktrees = new WorktreeManager(config.codex.worktreeRoot);
  }

  listSessions() {
    return this.store.listSessions();
  }

  getSession(id: string) {
    return this.store.sessions.get(id);
  }

  getSessionBySlackThread(input: { teamId: string; channelId: string; threadTs: string }) {
    return this.store.getSessionByThread(`${input.teamId}:${input.channelId}:${input.threadTs}`);
  }

  getApproval(id: string): ApprovalRequest | undefined {
    return this.store.approvals.get(id);
  }

  listPendingApprovalsForUser(slackUserId: string): ApprovalRequest[] {
    return [...this.store.approvals.values()]
      .filter((approval) => approval.status === "pending" && approval.requestedBySlackUserId === slackUserId)
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  }

  listAuditEventsForSlackUser(slackUserId: string, limit = 25): AuditEvent[] {
    const ownedSessionIds = new Set(
      [...this.store.sessions.values()]
        .filter((session) => session.ownerSlackUserId === slackUserId)
        .map((session) => session.id)
    );
    const maintainer = isSlackMaintainer(this.config, slackUserId);

    return this.store
      .listAuditEvents(250)
      .filter((event) => maintainer || event.actorSlackUserId === slackUserId || Boolean(event.sessionId && ownedSessionIds.has(event.sessionId)))
      .slice(0, limit);
  }

  recordAuditEvent(input: {
    type: AuditEventType;
    outcome: AuditOutcome;
    summary: string;
    actorSlackUserId?: string;
    slackThreadKey?: `${string}:${string}:${string}`;
    repoId?: string;
    sessionId?: string;
    taskRunId?: string;
    approvalId?: string;
    metadata?: AuditEvent["metadata"];
  }): AuditEvent {
    const event: AuditEvent = {
      id: nanoid(12),
      at: new Date().toISOString(),
      ...input,
      metadata: input.metadata ?? {}
    };
    this.store.saveAuditEvent(event);
    return event;
  }

  authorizeSlackInteraction(input: AuthorizationInput): void {
    this.assertAuthorizedAndAudit(input);
  }

  async collectSessionDiffSummary(sessionId: string): Promise<DiffSummary> {
    const session = this.store.sessions.get(sessionId);

    if (!session) {
      throw new Error("Session was not found.");
    }

    if (!session.workspacePath) {
      throw new Error("Session does not have a worktree yet.");
    }

    return collectDiffSummary(session.workspacePath);
  }

  async collectSessionDiffSummaryForSlackUser(input: {
    sessionId: string;
    requestingUserId: string;
    slackChannelId?: string;
  }): Promise<DiffSummary> {
    const session = this.store.sessions.get(input.sessionId);

    if (!session) {
      throw new Error("Session was not found.");
    }

    this.assertSessionActor({
      session,
      slackUserId: input.requestingUserId,
      slackChannelId: input.slackChannelId,
      action: "open_details",
      ownerMessage: "Only the Slack user who started this task can open the diff summary."
    });

    this.recordAuditEvent({
      type: "diff.opened",
      outcome: "success",
      summary: "Diff summary opened.",
      actorSlackUserId: input.requestingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id
    });

    return this.collectSessionDiffSummary(input.sessionId);
  }

  enqueueRunnerTaskForSession(input: {
    sessionId: string;
    requestingUserId: string;
    slackChannelId?: string;
    mode: TaskRun["mode"];
    prompt: string;
    sandbox: TaskRun["sandbox"];
    approvalPolicy: TaskRun["approvalPolicy"];
    maxAttempts?: number;
    availableAt?: string;
    now?: Date;
  }): EnqueueRunnerTaskForSessionResult {
    const session = this.store.sessions.get(input.sessionId);

    if (!session) {
      throw new Error("Session was not found.");
    }

    this.assertSessionActor({
      session,
      slackUserId: input.requestingUserId,
      slackChannelId: input.slackChannelId,
      action: "start_task",
      ownerMessage: "Only the Slack user who started the task can enqueue work."
    });

    if (!session.workspacePath) {
      throw new Error("Session does not have a worktree yet.");
    }

    if (this.hasActiveRun(session.id) || this.hasActiveQueuedJob(session.id)) {
      throw new Error("A Codex run is already active or queued in this Slack thread.");
    }

    const taskRun = createTaskRun({
      sessionId: session.id,
      mode: input.mode,
      sandbox: input.sandbox,
      approvalPolicy: input.approvalPolicy,
      prompt: input.prompt
    });
    this.store.saveTaskRun(taskRun);

    const queue = new DurableQueue(this.store);
    const job = queue.enqueueRunnerTask({
      repoId: session.repoId,
      task: {
        runId: taskRun.id,
        sessionId: session.id,
        mode: taskRun.mode,
        prompt: taskRun.prompt,
        workspacePath: session.workspacePath,
        sandbox: taskRun.sandbox,
        approvalPolicy: taskRun.approvalPolicy,
        model: this.config.codex.model,
        codexSessionId: session.codexSessionId
      },
      maxAttempts: input.maxAttempts,
      availableAt: input.availableAt,
      now: input.now
    });

    this.recordAuditEvent({
      type: "queue.enqueued",
      outcome: "info",
      summary: "Runner task enqueued.",
      actorSlackUserId: input.requestingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      taskRunId: taskRun.id,
      metadata: {
        queueJobId: job.id,
        mode: taskRun.mode,
        sandbox: taskRun.sandbox
      }
    });

    return { taskRun, job };
  }

  async enqueueLocalHandoffFromSlack(input: {
    slack: SlackTaskContext;
    repoId?: string;
    mode: Extract<TaskRun["mode"], "plan" | "implement" | "test">;
    maxAttempts?: number;
    availableAt?: string;
    now?: Date;
  }): Promise<EnqueueLocalHandoffResult> {
    const existingSession = this.getSessionBySlackThread(input.slack.thread);
    const repo = resolveRepoBinding(this.config, input.repoId ?? extractRepoId(input.slack.text) ?? existingSession?.repoId);

    if (existingSession && existingSession.repoId !== repo.id) {
      throw new Error(`This Slack thread is already bound to repo:${existingSession.repoId}. Start a new thread for repo:${repo.id}.`);
    }

    this.assertAuthorizedAndAudit({
      action: "start_task",
      slackUserId: input.slack.requestingUserId,
      slackChannelId: input.slack.thread.channelId,
      repoId: repo.id
    });

    const session = getOrCreateSession({ store: this.store, slack: input.slack, repo });

    if (this.hasActiveRun(session.id) || this.hasActiveQueuedJob(session.id)) {
      throw new Error("A Codex run is already active or queued in this Slack thread.");
    }

    if (this.hasPendingApproval(session.id)) {
      throw new Error("A plan is already awaiting approval in this thread. Approve it, revise it, or cancel before starting local handoff work.");
    }

    if (!session.workspacePath) {
      const worktree = await this.worktrees.createWorktree({
        sessionId: session.id,
        repo,
        branchName: session.branchName
      });

      session.workspacePath = worktree.workspacePath;
      session.sourceRepoPath = worktree.sourceRepoPath;
      session.branchName = worktree.branchName;
    }

    const sandbox = input.mode === "plan" ? "read-only" : "workspace-write";
    const taskRun = createTaskRun({
      sessionId: session.id,
      mode: input.mode,
      sandbox,
      approvalPolicy: "never",
      prompt: this.buildLocalHandoffPromptForSlack({
        slack: input.slack,
        repoId: repo.id,
        session,
        mode: input.mode
      })
    });
    this.store.saveTaskRun(taskRun);

    this.store.saveSession(session);

    const queue = new DurableQueue(this.store);
    const job = queue.enqueueRunnerTask({
      repoId: session.repoId,
      task: {
        runId: taskRun.id,
        sessionId: session.id,
        mode: taskRun.mode,
        prompt: taskRun.prompt,
        workspacePath: session.workspacePath,
        sandbox: taskRun.sandbox,
        approvalPolicy: taskRun.approvalPolicy,
        model: this.config.codex.model,
        codexSessionId: session.codexSessionId
      },
      maxAttempts: input.maxAttempts,
      availableAt: input.availableAt,
      now: input.now
    });

    this.recordAuditEvent({
      type: "queue.enqueued",
      outcome: "info",
      summary: "Local handoff runner task enqueued.",
      actorSlackUserId: input.slack.requestingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      taskRunId: taskRun.id,
      metadata: {
        queueJobId: job.id,
        mode: taskRun.mode,
        sandbox: taskRun.sandbox,
        source: "local-handoff"
      }
    });

    return { session, taskRun, job };
  }

  async createDraftPullRequest(input: {
    sessionId: string;
    requestingUserId: string;
    slackChannelId?: string;
  }): Promise<DraftPullRequestLifecycleResult> {
    const session = this.store.sessions.get(input.sessionId);

    if (!session) {
      throw new Error("Session was not found.");
    }

    this.assertSessionActor({
      session,
      slackUserId: input.requestingUserId,
      slackChannelId: input.slackChannelId,
      action: "create_pr",
      ownerMessage: "Only the Slack user who started the task can create a PR."
    });

    if (session.status !== "done") {
      throw new Error(`Session must be done before creating a PR. Current status: ${session.status}.`);
    }

    const activeRun = [...this.store.taskRuns.values()].find(
      (run) => run.sessionId === session.id && this.store.activeRuns.has(run.id)
    );

    if (activeRun) {
      throw new Error("Cannot create a PR while a run is still active.");
    }

    const diff = await collectDiffSummary(session.workspacePath);
    const bodyChangedFiles =
      session.draftPullRequest && diff.changedFiles.length === 0
        ? await getChangedFilesSince(session.workspacePath, session.draftPullRequest.commitSha)
        : diff.changedFiles;
    const latestRunSummary = this.latestRunSummary(session.id);
    const title = buildPullRequestTitle(latestRunSummary, session.id);
    const body = buildPullRequestBody({
      sessionId: session.id,
      repoId: session.repoId,
      branchName: session.branchName,
      summary: latestRunSummary,
      changedFiles: bodyChangedFiles
    });

    const result = await this.draftPullRequestCreator({
      workspacePath: session.workspacePath,
      branchName: session.branchName,
      title,
      body,
      existingPullRequest: session.draftPullRequest
    });
    const existingPullRequest = session.draftPullRequest;
    const operation = existingPullRequest ? inferPullRequestOperation(existingPullRequest, result) : "created";

    if (operation === "unchanged") {
      return { operation, result };
    }

    session.draftPullRequest = {
      ...result,
      createdAt: existingPullRequest?.createdAt ?? new Date().toISOString(),
      createdBySlackUserId: existingPullRequest?.createdBySlackUserId ?? input.requestingUserId,
      ...(existingPullRequest
        ? {
            updatedAt: new Date().toISOString(),
            updatedBySlackUserId: input.requestingUserId
          }
        : {})
    };
    touchSession(session, session.status);
    this.store.saveSession(session);

    this.recordAuditEvent({
      type: operation === "created" ? "pr.created" : "pr.updated",
      outcome: "success",
      summary: operation === "created" ? "Draft pull request created." : "Draft pull request updated.",
      actorSlackUserId: input.requestingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      metadata: {
        branchName: result.branchName,
        changedFiles: result.changedFiles.length,
        commitSha: result.commitSha.slice(0, 12),
        prUrl: result.prUrl
      }
    });

    return { operation, result };
  }

  async getDraftPullRequestStatusForSlackUser(input: {
    sessionId: string;
    requestingUserId: string;
    slackChannelId?: string;
  }): Promise<DraftPullRequestStatus> {
    const session = this.store.sessions.get(input.sessionId);

    if (!session) {
      throw new Error("Session was not found.");
    }

    this.assertSessionActor({
      session,
      slackUserId: input.requestingUserId,
      slackChannelId: input.slackChannelId,
      action: "status",
      ownerMessage: "Only the Slack user who started the task can check PR status."
    });

    if (!session.draftPullRequest) {
      throw new Error("No draft PR exists for this session.");
    }

    const status = await this.draftPullRequestStatusReader({
      workspacePath: session.workspacePath,
      prUrl: session.draftPullRequest.prUrl
    });

    if (status.isDraft === false && !session.draftPullRequest.readyForReviewAt) {
      session.draftPullRequest = {
        ...session.draftPullRequest,
        readyForReviewAt: new Date().toISOString(),
        readyForReviewBySlackUserId: input.requestingUserId
      };
      touchSession(session, session.status);
      this.store.saveSession(session);
    }

    this.recordAuditEvent({
      type: "pr.status_checked",
      outcome: "success",
      summary: "Draft pull request status checked.",
      actorSlackUserId: input.requestingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      metadata: {
        prUrl: status.prUrl,
        state: status.state ?? null,
        checksTotal: status.checksTotal ?? null,
        checksFailed: status.checksFailed ?? null,
        checksPending: status.checksPending ?? null
      }
    });

    return status;
  }

  async markDraftPullRequestReadyForReview(input: {
    sessionId: string;
    requestingUserId: string;
    slackChannelId?: string;
  }): Promise<DraftPullRequestReadyResult> {
    const session = this.store.sessions.get(input.sessionId);

    if (!session) {
      throw new Error("Session was not found.");
    }

    this.assertSessionActor({
      session,
      slackUserId: input.requestingUserId,
      slackChannelId: input.slackChannelId,
      action: "ready_for_review",
      ownerMessage: "Only the Slack user who started the task can mark the PR ready for review."
    });

    if (session.status !== "done") {
      throw new Error(`Session must be done before marking a PR ready for review. Current status: ${session.status}.`);
    }

    if (!session.draftPullRequest) {
      throw new Error("No draft PR exists for this session.");
    }

    const activeRun = [...this.store.taskRuns.values()].find(
      (run) => run.sessionId === session.id && this.store.activeRuns.has(run.id)
    );

    if (activeRun) {
      throw new Error("Cannot mark a PR ready for review while a run is still active.");
    }

    const ready = await this.draftPullRequestReadyMarker({
      workspacePath: session.workspacePath,
      prUrl: session.draftPullRequest.prUrl,
      branchName: session.branchName
    });

    if (!session.draftPullRequest.readyForReviewAt) {
      session.draftPullRequest = {
        ...session.draftPullRequest,
        readyForReviewAt: new Date().toISOString(),
        readyForReviewBySlackUserId: input.requestingUserId
      };
      touchSession(session, session.status);
      this.store.saveSession(session);
    }

    this.recordAuditEvent({
      type: "pr.ready_for_review",
      outcome: "success",
      summary:
        ready.operation === "ready"
          ? "Draft pull request marked ready for review."
          : "Pull request was already ready for review.",
      actorSlackUserId: input.requestingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      metadata: {
        operation: ready.operation,
        prUrl: ready.prUrl,
        state: ready.state ?? null,
        checksTotal: ready.checksTotal ?? null,
        checksFailed: ready.checksFailed ?? null,
        checksPending: ready.checksPending ?? null
      }
    });

    return ready;
  }

  async startPlanFromSlack(
    slack: SlackTaskContext,
    sink?: RunnerEventSink,
    options: StartPlanOptions = {}
  ): Promise<PlanTaskResult> {
    const existingSession = this.getSessionBySlackThread(slack.thread);
    const requestedRepoId = extractRepoId(slack.text) ?? existingSession?.repoId;
    const repo = resolveRepoBinding(this.config, requestedRepoId);

    if (existingSession && existingSession.repoId !== repo.id) {
      throw new Error(`This Slack thread is already bound to repo:${existingSession.repoId}. Start a new thread for repo:${repo.id}.`);
    }

    this.assertAuthorizedAndAudit({
      action: "start_task",
      slackUserId: slack.requestingUserId,
      slackChannelId: slack.thread.channelId,
      repoId: repo.id
    });
    const session = getOrCreateSession({ store: this.store, slack, repo });

    if (this.hasActiveRun(session.id)) {
      throw new Error("A Codex run is already active in this Slack thread.");
    }

    if (options.supersedePendingApprovals) {
      this.rejectPendingApprovalsForSession({
        session,
        actorSlackUserId: slack.requestingUserId,
        reason: "Superseded by a newer Slack follow-up plan."
      });
    }

    if (!session.workspacePath) {
      const worktree = await this.worktrees.createWorktree({
        sessionId: session.id,
        repo,
        branchName: session.branchName
      });

      session.workspacePath = worktree.workspacePath;
      session.sourceRepoPath = worktree.sourceRepoPath;
      session.branchName = worktree.branchName;
    }

    touchSession(session, "planning");
    this.store.saveSession(session);
    this.recordAuditEvent({
      type: "task.plan_started",
      outcome: "info",
      summary: "Read-only plan run started.",
      actorSlackUserId: slack.requestingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id
    });

    const planRun = createTaskRun({
      sessionId: session.id,
      mode: "plan",
      sandbox: "read-only",
      approvalPolicy: "never",
      prompt: this.buildPlanPromptForSlack({
        slack,
        repoId: repo.id,
        session,
        options
      })
    });
    planRun.status = "running";
    planRun.startedAt = new Date().toISOString();
    this.store.saveTaskRun(planRun);

    const handle = this.runner.start(
      {
        runId: planRun.id,
        sessionId: session.id,
        mode: "plan",
        prompt: planRun.prompt,
        workspacePath: session.workspacePath,
        sandbox: "read-only",
        approvalPolicy: "never",
        model: this.config.codex.model,
        codexSessionId: session.codexSessionId
      },
      sink
    );

    this.store.activeRuns.set(planRun.id, handle);
    const runnerResult = await handle.promise;
    this.store.activeRuns.delete(planRun.id);

    planRun.status = runnerResult.status === "completed" ? "awaiting_approval" : runnerResult.status;
    planRun.completedAt = new Date().toISOString();
    planRun.resultSummary = runnerResult.finalMessage;
    planRun.error = runnerResult.status === "failed" ? runnerResult.stderr || runnerResult.finalMessage : undefined;
    this.store.saveTaskRun(planRun);

    if (runnerResult.codexSessionId) {
      session.codexSessionId = runnerResult.codexSessionId;
    }

    if (runnerResult.status !== "completed") {
      touchSession(session, runnerResult.status === "cancelled" ? "cancelled" : "failed");
      this.store.saveSession(session);
      this.recordAuditEvent({
        type: "task.plan_failed",
        outcome: "failure",
        summary: runnerResult.status === "cancelled" ? "Plan run cancelled." : "Plan run failed.",
        actorSlackUserId: slack.requestingUserId,
        slackThreadKey: session.slackThreadKey,
        repoId: session.repoId,
        sessionId: session.id,
        taskRunId: planRun.id
      });
      throw new Error(runnerResult.status === "cancelled" ? "Codex run was cancelled." : runnerResult.finalMessage);
    }

    const approval = createExecutionApproval({
      taskRun: planRun,
      requestedBySlackUserId: slack.requestingUserId,
      summary: runnerResult.finalMessage,
      type: options.approvalType
    });
    this.store.saveApproval(approval);
    this.recordAuditEvent({
      type: "task.plan_completed",
      outcome: "success",
      summary: "Read-only plan completed.",
      actorSlackUserId: slack.requestingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      taskRunId: planRun.id
    });
    this.recordAuditEvent({
      type: "approval.created",
      outcome: "info",
      summary: "Execution approval requested.",
      actorSlackUserId: slack.requestingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      taskRunId: planRun.id,
      approvalId: approval.id
    });

    touchSession(session, "awaiting_approval");
    this.store.saveSession(session);

    return { approval, planRun, runnerResult };
  }

  async handleFollowUpFromSlack(slack: SlackTaskContext, sink?: RunnerEventSink): Promise<FollowUpResult> {
    const session = this.getSessionBySlackThread(slack.thread);
    const intent = classifyFollowUpIntent({ text: slack.text, hasExistingSession: Boolean(session) });

    if (!session) {
      if (intent === "new_task") {
        const plan = await this.startPlanFromSlack(slack, sink);
        return { kind: "plan", intent, ...plan, supersededApprovalIds: [] };
      }

      return {
        kind: "guidance",
        intent: "unsupported",
        message: "No Codex session was found in this Slack thread. Start a new task with a repo request first."
      };
    }

    const thread = parseThreadKey(session.slackThreadKey);

    if (slack.thread.channelId !== thread.channelId || slack.thread.threadTs !== thread.threadTs) {
      return {
        kind: "guidance",
        intent: "unsupported",
        session,
        message: "This follow-up does not match the original Codex Slack thread."
      };
    }

    this.assertSessionActor({
      session,
      slackUserId: slack.requestingUserId,
      slackChannelId: slack.thread.channelId,
      action:
        intent === "summarize_diff"
          ? "open_details"
          : intent === "update_pr"
            ? "create_pr"
            : intent === "ready_for_review"
              ? "ready_for_review"
              : intent === "cancel"
                ? "cancel_task"
                : "start_task",
      ownerMessage: "Only the Slack user who started the task can continue it."
    });

    if (this.hasActiveRun(session.id) && intent !== "cancel") {
      return {
        kind: "guidance",
        intent: "unsupported",
        session,
        message: "A Codex run is already active in this thread. Wait for it to finish or cancel it first."
      };
    }

    if (intent === "cancel") {
      const result = await this.cancelSession({
        sessionId: session.id,
        requestingUserId: slack.requestingUserId
      });
      return { kind: "cancel", intent, sessionId: session.id, ...result };
    }

    if (intent === "summarize_diff") {
      const diff = await this.collectSessionDiffSummaryForSlackUser({
        sessionId: session.id,
        requestingUserId: slack.requestingUserId,
        slackChannelId: slack.thread.channelId
      });
      return { kind: "diff", intent, session, diff };
    }

    if (intent === "update_pr") {
      if (session.draftPullRequest) {
        const lifecycle = await this.createDraftPullRequest({
          sessionId: session.id,
          requestingUserId: slack.requestingUserId,
          slackChannelId: slack.thread.channelId
        });
        return { kind: "pull_request", intent, session, lifecycle };
      }

      return {
        kind: "guidance",
        intent,
        session,
        message: "No draft PR exists for this session yet. Use the completion card's Create PR button after a completed run."
      };
    }

    if (intent === "ready_for_review") {
      if (session.draftPullRequest) {
        const ready = await this.markDraftPullRequestReadyForReview({
          sessionId: session.id,
          requestingUserId: slack.requestingUserId,
          slackChannelId: slack.thread.channelId
        });
        return { kind: "pr_ready", intent, session, ready };
      }

      return {
        kind: "guidance",
        intent: "unsupported",
        session,
        message: "No draft PR exists for this session yet. Create a draft PR before marking it ready for review."
      };
    }

    if (intent === "unsupported") {
      return {
        kind: "guidance",
        intent,
        session,
        message: "I could not map that follow-up to a supported Codex Relay action. Try: continue, revise plan, run tests, summarize diff, update PR, ready for review, or cancel."
      };
    }

    if (intent === "continue") {
      const pendingApprovals = this.pendingApprovalsForSession(session.id);

      if (pendingApprovals.length > 0) {
        return {
          kind: "guidance",
          intent: "unsupported",
          session,
          message: "A plan is already awaiting approval in this thread. Approve it, revise it, or cancel before continuing."
        };
      }
    }

    const shouldSupersedeApprovals = intent === "revise_plan" || intent === "run_tests";
    const pendingApprovalIdsBeforeReplacement = shouldSupersedeApprovals
      ? this.pendingApprovalsForSession(session.id).map((approval) => approval.id)
      : [];
    const plan = await this.startPlanFromSlack(
      {
        ...slack,
        text: normalizeFollowUpText({ intent, text: slack.text })
      },
      sink,
      {
        approvalType: intent === "run_tests" ? "run_tests" : "execute_plan",
        promptKind: intent === "run_tests" ? "test_plan" : "follow_up",
        followUpIntent: intent === "revise_plan" ? "revise_plan" : "continue",
        supersedePendingApprovals: shouldSupersedeApprovals
      }
    );
    const supersededApprovalIds = pendingApprovalIdsBeforeReplacement.filter(
      (approvalId) => this.store.approvals.get(approvalId)?.status === "rejected"
    );

    return { kind: "plan", intent, ...plan, supersededApprovalIds };
  }

  async approveAndExecute(approvalId: string, approvingUserId: string, sink?: RunnerEventSink): Promise<ExecuteTaskResult> {
    const approval = this.store.approvals.get(approvalId);

    if (!approval) {
      throw new Error("Approval request was not found.");
    }

    if (approval.status !== "pending") {
      throw new Error(`Approval request is already ${approval.status}.`);
    }

    if (isExpired(approval)) {
      approval.status = "expired";
      this.store.saveApproval(approval);
      throw new Error("Approval request expired.");
    }

    const session = this.store.sessions.get(approval.sessionId);
    const planRun = this.store.taskRuns.get(approval.taskRunId);

    if (!session || !planRun) {
      throw new Error("Approval is missing its session or plan run.");
    }

    this.assertSessionActor({
      session,
      slackUserId: approvingUserId,
      action: "approve_execution",
      ownerMessage: "Only the Slack user who started the task can approve execution."
    });

    if (this.hasActiveRun(session.id)) {
      throw new Error("A Codex run is already active in this Slack thread.");
    }

    approval.status = "approved";
    this.store.saveApproval(approval);
    touchSession(session, "running");
    this.store.saveSession(session);
    this.recordAuditEvent({
      type: "approval.approved",
      outcome: "success",
      summary: "Execution approval accepted.",
      actorSlackUserId: approvingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      taskRunId: planRun.id,
      approvalId: approval.id
    });

    const executionMode = approval.type === "run_tests" ? "test" : "implement";
    const executionPrompt =
      approval.type === "run_tests"
        ? buildTestRunPrompt({
            slack: {
              thread: parseThreadKey(session.slackThreadKey),
              requestingUserId: session.ownerSlackUserId,
              text: extractOriginalSlackRequest(planRun.prompt)
            },
            planSummary: approval.summary
          })
        : buildImplementPrompt({
            slack: {
              thread: parseThreadKey(session.slackThreadKey),
              requestingUserId: session.ownerSlackUserId,
              text: extractOriginalSlackRequest(planRun.prompt)
            },
            planSummary: approval.summary
          });

    const implementRun = createTaskRun({
      sessionId: session.id,
      mode: executionMode,
      sandbox: "workspace-write",
      approvalPolicy: "never",
      prompt: executionPrompt
    });
    implementRun.status = "running";
    implementRun.startedAt = new Date().toISOString();
    this.store.saveTaskRun(implementRun);
    this.recordAuditEvent({
      type: "execution.started",
      outcome: "info",
      summary: approval.type === "run_tests" ? "Workspace-write test run started." : "Workspace-write implementation run started.",
      actorSlackUserId: approvingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      taskRunId: implementRun.id,
      approvalId: approval.id
    });

    const handle = this.runner.start(
      {
        runId: implementRun.id,
        sessionId: session.id,
        mode: executionMode,
        prompt: implementRun.prompt,
        workspacePath: session.workspacePath,
        sandbox: "workspace-write",
        approvalPolicy: "never",
        model: this.config.codex.model,
        codexSessionId: session.codexSessionId
      },
      sink
    );

    this.store.activeRuns.set(implementRun.id, handle);
    const runnerResult = await handle.promise;
    this.store.activeRuns.delete(implementRun.id);

    implementRun.status = runnerResult.status;
    implementRun.completedAt = new Date().toISOString();
    implementRun.resultSummary = runnerResult.finalMessage;
    implementRun.error = runnerResult.status === "failed" ? runnerResult.stderr || runnerResult.finalMessage : undefined;
    this.store.saveTaskRun(implementRun);

    if (runnerResult.codexSessionId) {
      session.codexSessionId = runnerResult.codexSessionId;
    }

    const diff = await collectDiffSummary(session.workspacePath);
    touchSession(session, runnerResult.status === "completed" ? "done" : runnerResult.status);
    this.store.saveSession(session);
    this.recordAuditEvent({
      type: runnerResult.status === "completed" ? "execution.completed" : "execution.failed",
      outcome: runnerResult.status === "completed" ? "success" : "failure",
      summary:
        runnerResult.status === "completed"
          ? approval.type === "run_tests"
            ? "Test run completed."
            : "Implementation run completed."
          : approval.type === "run_tests"
            ? "Test run failed."
            : "Implementation run failed.",
      actorSlackUserId: approvingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      taskRunId: implementRun.id,
      approvalId: approval.id,
      metadata: {
        changedFiles: diff.changedFiles.length
      }
    });

    return { implementRun, runnerResult, diff };
  }

  async cancelRun(runId: string): Promise<void> {
    const handle = this.store.activeRuns.get(runId);
    await handle?.cancel();
    this.store.activeRuns.delete(runId);
  }

  async cancelSession(input: {
    sessionId: string;
    requestingUserId: string;
  }): Promise<{ cancelledRunIds: string[]; rejectedApprovalIds: string[] }> {
    const session = this.store.sessions.get(input.sessionId);

    if (!session) {
      throw new Error("Session was not found.");
    }

    this.assertSessionActor({
      session,
      slackUserId: input.requestingUserId,
      action: "cancel_task",
      ownerMessage: "Only the Slack user who started the task can cancel it."
    });

    const sessionRunIds = [...this.store.taskRuns.values()]
      .filter((run) => run.sessionId === session.id)
      .map((run) => run.id);
    const activeRunIds = sessionRunIds.filter((runId) => this.store.activeRuns.has(runId));
    const rejectedApprovalIds: string[] = [];

    await Promise.all(activeRunIds.map((runId) => this.cancelRun(runId)));

    for (const runId of activeRunIds) {
      const taskRun = this.store.taskRuns.get(runId);

      if (taskRun) {
        taskRun.status = "cancelled";
        taskRun.completedAt = new Date().toISOString();
        taskRun.error = "Cancelled from Slack.";
        this.store.saveTaskRun(taskRun);
      }
    }

    for (const approval of this.store.approvals.values()) {
      if (approval.sessionId === session.id && approval.status === "pending") {
        approval.status = "rejected";
        this.store.saveApproval(approval);
        rejectedApprovalIds.push(approval.id);
      }
    }

    touchSession(session, "cancelled");
    this.store.saveSession(session);
    this.recordAuditEvent({
      type: "task.cancelled",
      outcome: "success",
      summary: "Task cancelled from Slack.",
      actorSlackUserId: input.requestingUserId,
      slackThreadKey: session.slackThreadKey,
      repoId: session.repoId,
      sessionId: session.id,
      metadata: {
        cancelledRuns: activeRunIds.length,
        rejectedApprovals: rejectedApprovalIds.length
      }
    });

    return { cancelledRunIds: activeRunIds, rejectedApprovalIds };
  }

  async cancelSessionBySlackThread(input: {
    teamId: string;
    channelId: string;
    threadTs: string;
    requestingUserId: string;
  }): Promise<{ sessionId: string; cancelledRunIds: string[]; rejectedApprovalIds: string[] }> {
    const session = this.getSessionBySlackThread(input);

    if (!session) {
      throw new Error("No Codex session was found for this Slack thread.");
    }

    const result = await this.cancelSession({
      sessionId: session.id,
      requestingUserId: input.requestingUserId
    });

    return { sessionId: session.id, ...result };
  }

  async cleanupWorktrees(input: {
    requestingUserId: string;
    slackChannelId?: string;
    olderThanDays: number;
    dryRun: boolean;
  }): Promise<CleanupWorktreesResult> {
    this.assertAuthorizedAndAudit({
      action: "cleanup",
      slackUserId: input.requestingUserId,
      slackChannelId: input.slackChannelId
    });

    const normalizedOlderThanDays = Math.max(0, input.olderThanDays);
    const cutoff = Date.now() - normalizedOlderThanDays * 24 * 60 * 60 * 1000;
    const eligibleStatuses = new Set(["done", "failed", "cancelled"]);
    const sessions = this.store
      .listSessions()
      .filter((session) => session.ownerSlackUserId === input.requestingUserId)
      .filter((session) => Boolean(session.workspacePath))
      .filter((session) => !session.cleanedAt)
      .filter((session) => Date.parse(session.updatedAt) <= cutoff);
    const result: CleanupWorktreesResult = {
      dryRun: input.dryRun,
      policy: {
        olderThanDays: normalizedOlderThanDays,
        eligibleStatuses: [...eligibleStatuses],
        completedSessionRequiresDraftPullRequest: true,
        removesDirtyWorktrees: false
      },
      inspected: sessions.length,
      removed: [],
      skipped: []
    };

    for (const session of sessions) {
      if (!eligibleStatuses.has(session.status)) {
        result.skipped.push({
          sessionId: session.id,
          workspacePath: session.workspacePath,
          reason: `session status '${session.status}' is not cleanup-eligible`
        });
        continue;
      }

      if (this.hasActiveRun(session.id)) {
        result.skipped.push({
          sessionId: session.id,
          workspacePath: session.workspacePath,
          reason: "session still has an active run"
        });
        continue;
      }

      if (this.hasActiveQueuedJob(session.id)) {
        result.skipped.push({
          sessionId: session.id,
          workspacePath: session.workspacePath,
          reason: "session still has queued runner work"
        });
        continue;
      }

      if (this.hasPendingApproval(session.id)) {
        result.skipped.push({
          sessionId: session.id,
          workspacePath: session.workspacePath,
          reason: "session still has a pending approval"
        });
        continue;
      }

      if (session.status === "done" && !session.draftPullRequest) {
        result.skipped.push({
          sessionId: session.id,
          workspacePath: session.workspacePath,
          reason: "completed session has no draft PR metadata"
        });
        continue;
      }

      if (input.dryRun) {
        result.skipped.push({
          sessionId: session.id,
          workspacePath: session.workspacePath,
          reason: "dry run"
        });
        continue;
      }

      try {
        await this.worktrees.removeWorktree(session.sourceRepoPath, session.workspacePath);
        session.cleanedAt = new Date().toISOString();
        this.store.saveSession(session);
        result.removed.push({
          sessionId: session.id,
          workspacePath: session.workspacePath
        });
      } catch (error) {
        result.skipped.push({
          sessionId: session.id,
          workspacePath: session.workspacePath,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.recordAuditEvent({
      type: "cleanup.completed",
      outcome: "success",
      summary: input.dryRun ? "Worktree cleanup dry run completed." : "Worktree cleanup completed.",
      actorSlackUserId: input.requestingUserId,
      metadata: {
        dryRun: input.dryRun,
        olderThanDays: normalizedOlderThanDays,
        eligibleStatuses: [...eligibleStatuses].join(","),
        completedSessionRequiresDraftPullRequest: true,
        removesDirtyWorktrees: false,
        inspected: result.inspected,
        removed: result.removed.length,
        skipped: result.skipped.length
      }
    });

    return result;
  }

  private buildPlanPromptForSlack(input: {
    slack: SlackTaskContext;
    repoId: string;
    session: Session;
    options: StartPlanOptions;
  }): string {
    const previousSummary = this.latestRunSummary(input.session.id);

    if (input.options.promptKind === "test_plan") {
      return buildTestPlanPrompt({
        slack: input.slack,
        repoId: input.repoId,
        previousSummary
      });
    }

    if (input.options.promptKind === "follow_up") {
      return buildFollowUpPlanPrompt({
        slack: input.slack,
        repoId: input.repoId,
        previousSummary,
        intent: input.options.followUpIntent ?? "continue"
      });
    }

    return buildPlanPrompt({ slack: input.slack, repoId: input.repoId });
  }

  private buildLocalHandoffPromptForSlack(input: {
    slack: SlackTaskContext;
    repoId: string;
    session: Session;
    mode: Extract<TaskRun["mode"], "plan" | "implement" | "test">;
  }): string {
    if (input.mode === "plan") {
      return buildPlanPrompt({ slack: input.slack, repoId: input.repoId });
    }

    return buildLocalHandoffPrompt({
      slack: input.slack,
      repoId: input.repoId,
      mode: input.mode,
      previousSummary: this.latestRunSummary(input.session.id)
    });
  }

  private pendingApprovalsForSession(sessionId: string): ApprovalRequest[] {
    return [...this.store.approvals.values()].filter(
      (approval) => approval.sessionId === sessionId && approval.status === "pending"
    );
  }

  private rejectPendingApprovalsForSession(input: {
    session: Session;
    excludeApprovalId?: string;
    actorSlackUserId: string;
    reason: string;
  }): string[] {
    const rejectedApprovalIds: string[] = [];

    for (const approval of this.pendingApprovalsForSession(input.session.id)) {
      if (approval.id === input.excludeApprovalId) {
        continue;
      }

      approval.status = "rejected";
      this.store.saveApproval(approval);
      rejectedApprovalIds.push(approval.id);
      this.recordAuditEvent({
        type: "approval.rejected",
        outcome: "info",
        summary: input.reason,
        actorSlackUserId: input.actorSlackUserId,
        slackThreadKey: input.session.slackThreadKey,
        repoId: input.session.repoId,
        sessionId: input.session.id,
        taskRunId: approval.taskRunId,
        approvalId: approval.id
      });
    }

    return rejectedApprovalIds;
  }

  private latestRunSummary(sessionId: string): string {
    const runs = [...this.store.taskRuns.values()]
      .filter((run) => run.sessionId === sessionId && run.resultSummary)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

    return runs[0]?.resultSummary ?? "Codex Slack task changes.";
  }

  private hasActiveRun(sessionId: string): boolean {
    return [...this.store.taskRuns.values()].some((run) => run.sessionId === sessionId && this.store.activeRuns.has(run.id));
  }

  private hasActiveQueuedJob(sessionId: string): boolean {
    return this.store
      .listQueueJobs()
      .some((job) => job.sessionId === sessionId && (job.status === "queued" || job.status === "leased"));
  }

  private hasPendingApproval(sessionId: string): boolean {
    return [...this.store.approvals.values()].some(
      (approval) => approval.sessionId === sessionId && approval.status === "pending"
    );
  }

  private assertSessionActor(input: {
    session: { ownerSlackUserId: string; repoId: string; slackThreadKey: `${string}:${string}:${string}` };
    slackUserId: string;
    slackChannelId?: string;
    action: AuthorizationAction;
    ownerMessage: string;
  }): void {
    const thread = parseThreadKey(input.session.slackThreadKey);

    this.assertAuthorizedAndAudit({
      action: input.action,
      slackUserId: input.slackUserId,
      slackChannelId: input.slackChannelId ?? thread.channelId,
      repoId: input.session.repoId
    });

    if (input.slackUserId !== input.session.ownerSlackUserId && !isSlackMaintainer(this.config, input.slackUserId)) {
      throw new Error(input.ownerMessage);
    }
  }

  private assertAuthorizedAndAudit(input: AuthorizationInput): void {
    const result = authorizeSlackAction(this.config, input);

    if (!result.ok) {
      this.recordAuditEvent({
        type: "authorization.denied",
        outcome: "denied",
        summary: `Authorization denied for ${input.action}: ${result.reason ?? "unknown reason"}.`,
        actorSlackUserId: input.slackUserId,
        repoId: input.repoId,
        metadata: {
          action: input.action,
          reason: result.reason ?? "unknown",
          hasChannel: Boolean(input.slackChannelId)
        }
      });
      throw new AuthorizationError("You are not authorized to use Codex Relay for this Slack user, channel, or repo.", result);
    }
  }
}

function createTaskRun(input: {
  sessionId: string;
  mode: TaskRun["mode"];
  sandbox: TaskRun["sandbox"];
  approvalPolicy: TaskRun["approvalPolicy"];
  prompt: string;
}): TaskRun {
  return {
    id: nanoid(12),
    sessionId: input.sessionId,
    mode: input.mode,
    prompt: input.prompt,
    status: "queued",
    sandbox: input.sandbox,
    approvalPolicy: input.approvalPolicy
  };
}

function parseThreadKey(threadKey: `${string}:${string}:${string}`) {
  const [teamId, channelId, threadTs] = threadKey.split(":");

  if (!teamId || !channelId || !threadTs) {
    throw new Error(`Invalid Slack thread key: ${threadKey}`);
  }

  return { teamId, channelId, threadTs };
}

function extractOriginalSlackRequest(planPrompt: string): string {
  const marker = "Slack request:\n";
  const start = planPrompt.indexOf(marker);

  if (start === -1) {
    return planPrompt;
  }

  const afterMarker = planPrompt.slice(start + marker.length);
  const end = afterMarker.search(/\n\nReturn a concise/u);
  return (end === -1 ? afterMarker : afterMarker.slice(0, end)).trim();
}

function inferPullRequestOperation(
  existing: DraftPullRequestResult,
  next: DraftPullRequestResult
): DraftPullRequestLifecycleResult["operation"] {
  return existing.prUrl === next.prUrl && existing.commitSha === next.commitSha ? "unchanged" : "updated";
}
