export type RunnerKind = "exec" | "sdk" | "app-server";

export type TaskMode = "plan" | "implement" | "review" | "explain" | "test" | "test-fix";

export type SessionStatus =
  | "idle"
  | "planning"
  | "running"
  | "awaiting_approval"
  | "done"
  | "failed"
  | "cancelled";

export type TaskRunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type QueueJobStatus = "queued" | "leased" | "completed" | "failed" | "cancelled";

export type QueueJobKind = "runner_task";

export type ControlPlaneKind = "slack" | "email";

export type WorkspaceKind = "worktree" | "source";

export type SlackNotificationStatus = "pending" | "leased" | "sent" | "failed";

export type SlackNotificationKind = "runner.started" | "plan.ready" | "runner.completed" | "runner.failed";

export type SlackNotificationSeverity = "info" | "success" | "failure";

export type EmailNotificationStatus = "pending" | "leased" | "sent" | "failed";

export type EmailNotificationKind =
  | "plan.ready"
  | "runner.completed"
  | "runner.failed"
  | "email.test"
  | "email.command_accepted"
  | "email.command_rejected"
  | "email.command_failed";

export type EmailNotificationSeverity = "info" | "success" | "failure";

export type EmailInboundStatus = "processing" | "queued" | "rejected" | "ignored" | "failed";

export type ApprovalType = "execute_plan" | "run_tests" | "sandbox_escalation" | "rules_prompt";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type ApprovalPolicy = "never" | "on-request" | "untrusted";

export type SlackThreadKey = `${string}:${string}:${string}`;

export type AuditOutcome = "success" | "failure" | "denied" | "info";

export type AuditEventType =
  | "authorization.allowed"
  | "authorization.denied"
  | "email.command_received"
  | "email.command_queued"
  | "email.command_rejected"
  | "email.command_ignored"
  | "email.command_failed"
  | "email.notification_enqueued"
  | "email.notification_sent"
  | "email.notification_failed"
  | "task.ask_started"
  | "task.ask_completed"
  | "task.ask_failed"
  | "task.plan_started"
  | "task.plan_completed"
  | "task.plan_failed"
  | "approval.created"
  | "approval.approved"
  | "approval.rejected"
  | "execution.started"
  | "execution.completed"
  | "execution.failed"
  | "task.cancelled"
  | "cleanup.completed"
  | "diff.opened"
  | "queue.enqueued"
  | "queue.claimed"
  | "queue.completed"
  | "queue.failed"
  | "pr.created"
  | "pr.updated"
  | "pr.status_checked"
  | "pr.ready_for_review";

export interface SlackThreadRef {
  teamId: string;
  channelId: string;
  threadTs: string;
}

export interface RepoBinding {
  id: string;
  path: string;
  defaultBranch?: string;
}

export interface Session {
  id: string;
  controlPlane: ControlPlaneKind;
  slackThreadKey: SlackThreadKey;
  ownerSlackUserId: string;
  repoId: string;
  sourceRepoPath: string;
  workspacePath: string;
  workspaceKind: WorkspaceKind;
  branchName: string;
  runnerKind: RunnerKind;
  codexSessionId?: string;
  status: SessionStatus;
  draftPullRequest?: SessionDraftPullRequest;
  cleanedAt?: string;
  email?: EmailSessionRef;
  createdAt: string;
  updatedAt: string;
}

export interface EmailSessionRef {
  mailboxId: string;
  threadId: string;
  sender: string;
  firstMessageId: string;
}

export interface TaskRun {
  id: string;
  sessionId: string;
  mode: TaskMode;
  prompt: string;
  status: TaskRunStatus;
  sandbox: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  startedAt?: string;
  completedAt?: string;
  resultSummary?: string;
  error?: string;
}

export interface ApprovalRequest {
  id: string;
  taskRunId: string;
  sessionId: string;
  requestedBySlackUserId: string;
  type: ApprovalType;
  summary: string;
  expiresAt: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  type: AuditEventType;
  outcome: AuditOutcome;
  summary: string;
  actorSlackUserId?: string;
  slackThreadKey?: SlackThreadKey;
  repoId?: string;
  sessionId?: string;
  taskRunId?: string;
  approvalId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SlackTaskContext {
  thread: SlackThreadRef;
  requestingUserId: string;
  text: string;
  selectedMessageText?: string;
  permalink?: string;
}

export interface RunnerTaskSpec {
  runId: string;
  sessionId: string;
  mode: TaskMode;
  prompt: string;
  workspacePath: string;
  sandbox: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  model?: string;
  images?: string[];
  codexSessionId?: string;
}

export interface QueueLease {
  id: string;
  runnerId: string;
  claimedAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface QueueJob {
  id: string;
  kind: QueueJobKind;
  status: QueueJobStatus;
  sessionId: string;
  repoId: string;
  taskRunId?: string;
  payload: RunnerTaskSpec;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  lease?: QueueLease;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  error?: string;
}

export interface QueueClaim {
  job: QueueJob;
  lease: QueueLease;
}

export interface SlackNotificationLease {
  id: string;
  workerId: string;
  claimedAt: string;
  expiresAt: string;
}

export interface SlackNotification {
  id: string;
  kind: SlackNotificationKind;
  status: SlackNotificationStatus;
  severity: SlackNotificationSeverity;
  slackThreadKey: SlackThreadKey;
  sessionId: string;
  repoId?: string;
  taskRunId?: string;
  approvalId?: string;
  queueJobId?: string;
  title: string;
  detail: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  deliveredAt?: string;
  failedAt?: string;
  error?: string;
  lease?: SlackNotificationLease;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SlackNotificationClaim {
  notification: SlackNotification;
  lease: SlackNotificationLease;
}

export interface EmailNotificationLease {
  id: string;
  workerId: string;
  claimedAt: string;
  expiresAt: string;
}

export interface EmailNotification {
  id: string;
  kind: EmailNotificationKind;
  status: EmailNotificationStatus;
  severity: EmailNotificationSeverity;
  to: string[];
  subject: string;
  text: string;
  sessionId?: string;
  repoId?: string;
  taskRunId?: string;
  approvalId?: string;
  queueJobId?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  deliveredAt?: string;
  failedAt?: string;
  error?: string;
  lease?: EmailNotificationLease;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface EmailNotificationClaim {
  notification: EmailNotification;
  lease: EmailNotificationLease;
}

export interface EmailInboundMessageRecord {
  id: string;
  mailboxId: string;
  messageId: string;
  threadId: string;
  from: string;
  subject?: string;
  status: EmailInboundStatus;
  commandKind?: string;
  reason?: string;
  sessionId?: string;
  taskRunId?: string;
  queueJobId?: string;
  receivedAt?: string;
  processedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface RunnerEvent {
  runId: string;
  type: string;
  message?: string;
  raw?: unknown;
  at: string;
}

export interface RunnerResult {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  finalMessage: string;
  stdout: string;
  stderr: string;
  codexSessionId?: string;
  exitCode?: number | null;
}

export interface DraftPullRequestResult {
  title: string;
  body: string;
  branchName: string;
  commitSha: string;
  prUrl: string;
  changedFiles: string[];
}

export interface SessionDraftPullRequest extends DraftPullRequestResult {
  createdAt: string;
  createdBySlackUserId: string;
  updatedAt?: string;
  updatedBySlackUserId?: string;
  readyForReviewAt?: string;
  readyForReviewBySlackUserId?: string;
}

export type DraftPullRequestOperation = "created" | "updated" | "unchanged";

export interface DraftPullRequestLifecycleResult {
  operation: DraftPullRequestOperation;
  result: DraftPullRequestResult;
}

export type DraftPullRequestCheckState = "passed" | "failed" | "pending" | "skipped" | "unknown";

export interface DraftPullRequestCheckDetail {
  name: string;
  state: DraftPullRequestCheckState;
  status?: string;
  conclusion?: string;
  workflowName?: string;
  url?: string;
}

export interface DraftPullRequestStatus {
  prUrl: string;
  state?: string;
  isDraft?: boolean;
  mergeable?: string | null;
  headRefName?: string;
  checksSummary: string;
  checksTotal?: number;
  checksPassed?: number;
  checksFailed?: number;
  checksPending?: number;
  checkDetails?: DraftPullRequestCheckDetail[];
  checksHidden?: number;
  checkedAt: string;
}

export type DraftPullRequestReadyOperation = "ready" | "already_ready";

export interface DraftPullRequestReadyResult extends DraftPullRequestStatus {
  operation: DraftPullRequestReadyOperation;
}

export interface RunHandle {
  runId: string;
  promise: Promise<RunnerResult>;
  cancel: () => Promise<void>;
}

export type RunnerEventSink = (event: RunnerEvent) => void | Promise<void>;

export interface RunnerAdapter {
  start(task: RunnerTaskSpec, sink?: RunnerEventSink): RunHandle;
  resume(sessionId: string, prompt: string, sink?: RunnerEventSink): RunHandle;
  cancel(runId: string): Promise<void>;
}

export function slackThreadKey(ref: SlackThreadRef): SlackThreadKey {
  return `${ref.teamId}:${ref.channelId}:${ref.threadTs}`;
}
