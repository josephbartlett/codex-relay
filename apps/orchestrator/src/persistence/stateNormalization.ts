import type {
  ApprovalRequest,
  AuditEvent,
  QueueJob,
  Session,
  SlackNotification,
  TaskRun
} from "../../../../packages/shared/src/types.js";

export interface PersistedState {
  version: 1 | 2 | 3;
  sessions: Session[];
  taskRuns: TaskRun[];
  approvals: ApprovalRequest[];
  auditEvents?: AuditEvent[];
  queueJobs?: QueueJob[];
  slackNotifications?: SlackNotification[];
}

export function normalizeSession(session: Session): Session {
  if (session.status === "planning" || session.status === "running") {
    return {
      ...session,
      status: "failed",
      updatedAt: new Date().toISOString()
    };
  }

  return session;
}

export function normalizeTaskRun(taskRun: TaskRun): TaskRun {
  if (taskRun.status === "running") {
    return {
      ...taskRun,
      status: "failed",
      completedAt: new Date().toISOString(),
      error: "The Slack gateway restarted before this run completed."
    };
  }

  return taskRun;
}

export function normalizeApproval(approval: ApprovalRequest): ApprovalRequest {
  if (approval.status === "pending" && Date.parse(approval.expiresAt) <= Date.now()) {
    return {
      ...approval,
      status: "expired"
    };
  }

  return approval;
}

export function normalizeAuditEvent(event: AuditEvent): AuditEvent {
  return {
    ...event,
    metadata: event.metadata ?? {}
  };
}

export function normalizeQueueJob(job: QueueJob): QueueJob {
  const updatedAt = job.updatedAt ?? job.createdAt ?? new Date().toISOString();

  return {
    ...job,
    attempts: job.attempts ?? 0,
    maxAttempts: job.maxAttempts ?? 3,
    createdAt: job.createdAt ?? updatedAt,
    updatedAt,
    availableAt: job.availableAt ?? updatedAt
  };
}

export function normalizeSlackNotification(notification: SlackNotification): SlackNotification {
  const updatedAt = notification.updatedAt ?? notification.createdAt ?? new Date().toISOString();

  return {
    ...notification,
    status: notification.status ?? "pending",
    severity: notification.severity ?? "info",
    attempts: notification.attempts ?? 0,
    maxAttempts: notification.maxAttempts ?? 3,
    createdAt: notification.createdAt ?? updatedAt,
    updatedAt,
    availableAt: notification.availableAt ?? updatedAt,
    metadata: notification.metadata ?? {}
  };
}
