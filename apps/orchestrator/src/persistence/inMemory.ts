import { randomUUID } from "node:crypto";
import type {
  ApprovalRequest,
  AuditEvent,
  EmailInboundMessageRecord,
  EmailNotification,
  EmailNotificationClaim,
  EmailNotificationLease,
  QueueClaim,
  QueueJob,
  QueueLease,
  RunHandle,
  Session,
  SlackNotification,
  SlackNotificationClaim,
  SlackNotificationLease,
  SlackThreadKey,
  TaskRun
} from "../../../../packages/shared/src/types.js";

export interface QueueClaimInput {
  runnerId: string;
  now: Date;
  leaseTtlMs: number;
  sessionConcurrencyLimit: number;
  repoConcurrencyLimit: number;
}

export interface SlackNotificationClaimInput {
  workerId: string;
  now: Date;
  leaseTtlMs: number;
}

export interface SlackNotificationMutationInput {
  notificationId: string;
  leaseId: string;
  workerId: string;
  now: Date;
}

export interface EmailNotificationClaimInput {
  workerId: string;
  now: Date;
  leaseTtlMs: number;
}

export interface EmailNotificationMutationInput {
  notificationId: string;
  leaseId: string;
  workerId: string;
  now: Date;
}

export class InMemoryStore {
  readonly sessions = new Map<string, Session>();
  readonly sessionIdsByThread = new Map<SlackThreadKey, string>();
  readonly taskRuns = new Map<string, TaskRun>();
  readonly approvals = new Map<string, ApprovalRequest>();
  readonly auditEvents = new Map<string, AuditEvent>();
  readonly queueJobs = new Map<string, QueueJob>();
  readonly slackNotifications = new Map<string, SlackNotification>();
  readonly emailNotifications = new Map<string, EmailNotification>();
  readonly emailInboundMessages = new Map<string, EmailInboundMessageRecord>();
  readonly activeRuns = new Map<string, RunHandle>();

  getSessionByThread(threadKey: SlackThreadKey): Session | undefined {
    const id = this.sessionIdsByThread.get(threadKey);
    return id ? this.sessions.get(id) : undefined;
  }

  saveSession(session: Session): void {
    this.sessions.set(session.id, session);
    this.sessionIdsByThread.set(session.slackThreadKey, session.id);
  }

  saveTaskRun(run: TaskRun): void {
    this.taskRuns.set(run.id, run);
  }

  saveApproval(approval: ApprovalRequest): void {
    this.approvals.set(approval.id, approval);
  }

  saveAuditEvent(event: AuditEvent): void {
    this.auditEvents.set(event.id, event);
  }

  saveQueueJob(job: QueueJob): void {
    this.queueJobs.set(job.id, job);
  }

  getQueueJob(id: string): QueueJob | undefined {
    return this.queueJobs.get(id);
  }

  listQueueJobs(): QueueJob[] {
    return [...this.queueJobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  saveSlackNotification(notification: SlackNotification): void {
    this.slackNotifications.set(notification.id, notification);
  }

  getSlackNotification(id: string): SlackNotification | undefined {
    return this.slackNotifications.get(id);
  }

  listSlackNotifications(): SlackNotification[] {
    return [...this.slackNotifications.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  saveEmailNotification(notification: EmailNotification): void {
    this.emailNotifications.set(notification.id, notification);
  }

  getEmailNotification(id: string): EmailNotification | undefined {
    return this.emailNotifications.get(id);
  }

  listEmailNotifications(): EmailNotification[] {
    return [...this.emailNotifications.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  saveEmailInboundMessage(record: EmailInboundMessageRecord): void {
    this.emailInboundMessages.set(record.id, record);
  }

  getEmailInboundMessage(id: string): EmailInboundMessageRecord | undefined {
    return this.emailInboundMessages.get(id);
  }

  listEmailInboundMessages(): EmailInboundMessageRecord[] {
    return [...this.emailInboundMessages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  claimNextEmailNotification(input: EmailNotificationClaimInput): EmailNotificationClaim | undefined {
    for (const notification of this.listEmailNotifications()) {
      const expiredLease =
        notification.status === "leased" &&
        notification.lease &&
        Date.parse(notification.lease.expiresAt) <= input.now.getTime();
      const pending = notification.status === "pending" && Date.parse(notification.availableAt) <= input.now.getTime();

      if (!pending && !expiredLease) {
        continue;
      }

      if (expiredLease && notification.attempts >= notification.maxAttempts) {
        notification.status = "failed";
        notification.failedAt = input.now.toISOString();
        notification.updatedAt = input.now.toISOString();
        notification.error = notification.error ?? "Email notification delivery lease expired after maximum attempts.";
        notification.lease = undefined;
        this.saveEmailNotification(notification);
        continue;
      }

      const lease = createEmailNotificationLease({
        workerId: input.workerId,
        now: input.now,
        leaseTtlMs: input.leaseTtlMs
      });

      notification.status = "leased";
      notification.lease = lease;
      notification.attempts += 1;
      notification.updatedAt = input.now.toISOString();
      this.saveEmailNotification(notification);
      return { notification, lease };
    }

    return undefined;
  }

  markEmailNotificationSent(input: EmailNotificationMutationInput): EmailNotification {
    const notification = this.requireLeasedEmailNotification(input);
    notification.status = "sent";
    notification.deliveredAt = input.now.toISOString();
    notification.updatedAt = input.now.toISOString();
    notification.lease = undefined;
    notification.error = undefined;
    this.saveEmailNotification(notification);
    return notification;
  }

  markEmailNotificationFailed(input: EmailNotificationMutationInput & { error: string; retryAfterMs: number }): EmailNotification {
    const notification = this.requireLeasedEmailNotification(input);
    notification.updatedAt = input.now.toISOString();
    notification.error = input.error;
    notification.lease = undefined;

    if (notification.attempts < notification.maxAttempts) {
      notification.status = "pending";
      notification.availableAt = new Date(input.now.getTime() + input.retryAfterMs).toISOString();
    } else {
      notification.status = "failed";
      notification.failedAt = input.now.toISOString();
    }

    this.saveEmailNotification(notification);
    return notification;
  }

  claimNextSlackNotification(input: SlackNotificationClaimInput): SlackNotificationClaim | undefined {
    for (const notification of this.listSlackNotifications()) {
      const expiredLease =
        notification.status === "leased" &&
        notification.lease &&
        Date.parse(notification.lease.expiresAt) <= input.now.getTime();
      const pending = notification.status === "pending" && Date.parse(notification.availableAt) <= input.now.getTime();

      if (!pending && !expiredLease) {
        continue;
      }

      if (expiredLease && notification.attempts >= notification.maxAttempts) {
        notification.status = "failed";
        notification.failedAt = input.now.toISOString();
        notification.updatedAt = input.now.toISOString();
        notification.error = notification.error ?? "Slack notification delivery lease expired after maximum attempts.";
        notification.lease = undefined;
        this.saveSlackNotification(notification);
        continue;
      }

      const lease = createSlackNotificationLease({
        workerId: input.workerId,
        now: input.now,
        leaseTtlMs: input.leaseTtlMs
      });

      notification.status = "leased";
      notification.lease = lease;
      notification.attempts += 1;
      notification.updatedAt = input.now.toISOString();
      this.saveSlackNotification(notification);
      return { notification, lease };
    }

    return undefined;
  }

  markSlackNotificationSent(input: SlackNotificationMutationInput): SlackNotification {
    const notification = this.requireLeasedSlackNotification(input);
    notification.status = "sent";
    notification.deliveredAt = input.now.toISOString();
    notification.updatedAt = input.now.toISOString();
    notification.lease = undefined;
    notification.error = undefined;
    this.saveSlackNotification(notification);
    return notification;
  }

  markSlackNotificationFailed(input: SlackNotificationMutationInput & { error: string; retryAfterMs: number }): SlackNotification {
    const notification = this.requireLeasedSlackNotification(input);
    notification.updatedAt = input.now.toISOString();
    notification.error = input.error;
    notification.lease = undefined;

    if (notification.attempts < notification.maxAttempts) {
      notification.status = "pending";
      notification.availableAt = new Date(input.now.getTime() + input.retryAfterMs).toISOString();
    } else {
      notification.status = "failed";
      notification.failedAt = input.now.toISOString();
    }

    this.saveSlackNotification(notification);
    return notification;
  }

  claimNextQueueJob(input: QueueClaimInput): QueueClaim | undefined {
    for (const job of this.listQueueJobs()) {
      if (job.status !== "queued" || Date.parse(job.availableAt) > input.now.getTime()) {
        continue;
      }

      if (!canClaimJob(this.listQueueJobs(), job, input)) {
        continue;
      }

      const lease = createQueueLease({
        runnerId: input.runnerId,
        now: input.now,
        leaseTtlMs: input.leaseTtlMs
      });

      job.status = "leased";
      job.lease = lease;
      job.attempts += 1;
      job.updatedAt = input.now.toISOString();
      this.saveQueueJob(job);
      return { job, lease };
    }

    return undefined;
  }

  listSessions(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listAuditEvents(limit = 100): AuditEvent[] {
    return [...this.auditEvents.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  private requireLeasedSlackNotification(input: SlackNotificationMutationInput): SlackNotification {
    const notification = this.getSlackNotification(input.notificationId);

    if (!notification) {
      throw new Error(`Slack notification '${input.notificationId}' was not found.`);
    }

    if (notification.status !== "leased" || !notification.lease) {
      throw new Error(`Slack notification '${notification.id}' is not leased.`);
    }

    if (notification.lease.id !== input.leaseId || notification.lease.workerId !== input.workerId) {
      throw new Error(`Slack notification '${notification.id}' lease does not match the requesting worker.`);
    }

    if (Date.parse(notification.lease.expiresAt) <= input.now.getTime()) {
      throw new Error(`Slack notification '${notification.id}' lease expired.`);
    }

    return notification;
  }

  private requireLeasedEmailNotification(input: EmailNotificationMutationInput): EmailNotification {
    const notification = this.getEmailNotification(input.notificationId);

    if (!notification) {
      throw new Error(`Email notification '${input.notificationId}' was not found.`);
    }

    if (notification.status !== "leased" || !notification.lease) {
      throw new Error(`Email notification '${notification.id}' is not leased.`);
    }

    if (notification.lease.id !== input.leaseId || notification.lease.workerId !== input.workerId) {
      throw new Error(`Email notification '${notification.id}' lease does not match the requesting worker.`);
    }

    if (Date.parse(notification.lease.expiresAt) <= input.now.getTime()) {
      throw new Error(`Email notification '${notification.id}' lease expired.`);
    }

    return notification;
  }
}

export function createQueueLease(input: {
  runnerId: string;
  now: Date;
  leaseTtlMs: number;
  leaseId?: string;
  claimedAt?: string;
}): QueueLease {
  return {
    id: input.leaseId ?? randomUUID(),
    runnerId: input.runnerId,
    claimedAt: input.claimedAt ?? input.now.toISOString(),
    heartbeatAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + input.leaseTtlMs).toISOString()
  };
}

export function createSlackNotificationLease(input: {
  workerId: string;
  now: Date;
  leaseTtlMs: number;
}): SlackNotificationLease {
  return {
    id: randomUUID(),
    workerId: input.workerId,
    claimedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + input.leaseTtlMs).toISOString()
  };
}

export function createEmailNotificationLease(input: {
  workerId: string;
  now: Date;
  leaseTtlMs: number;
}): EmailNotificationLease {
  return {
    id: randomUUID(),
    workerId: input.workerId,
    claimedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + input.leaseTtlMs).toISOString()
  };
}

function canClaimJob(jobs: QueueJob[], candidate: QueueJob, input: QueueClaimInput): boolean {
  const leased = jobs.filter((job) => job.status === "leased" && job.lease);
  const sessionLeases = leased.filter((job) => job.sessionId === candidate.sessionId).length;
  const repoLeases = leased.filter((job) => job.repoId === candidate.repoId).length;

  return sessionLeases < input.sessionConcurrencyLimit && repoLeases < input.repoConcurrencyLimit;
}
