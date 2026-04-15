import { nanoid } from "nanoid";
import type { Logger } from "../../../packages/shared/src/logging.js";
import type { InMemoryStore } from "../../orchestrator/src/persistence/inMemory.js";
import { sanitizeNotificationText } from "../../orchestrator/src/slackNotifications.js";
import type { EmailSender } from "./smtp.js";

export interface PublishEmailNotificationsOptions {
  store: InMemoryStore;
  sender: EmailSender;
  logger?: Logger;
  workerId?: string;
  now?: () => Date;
  limit?: number;
  leaseTtlMs?: number;
  retryAfterMs?: number;
}

export interface PublishEmailNotificationsResult {
  sent: number;
  failed: number;
  claimed: number;
}

const defaultWorkerId = `email-publisher-${process.pid}`;
const defaultLimit = 10;
const defaultLeaseTtlMs = 60_000;
const defaultRetryAfterMs = 30_000;

export async function publishPendingEmailNotifications(
  options: PublishEmailNotificationsOptions
): Promise<PublishEmailNotificationsResult> {
  const workerId = options.workerId ?? defaultWorkerId;
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? defaultLimit;
  const leaseTtlMs = options.leaseTtlMs ?? defaultLeaseTtlMs;
  const retryAfterMs = options.retryAfterMs ?? defaultRetryAfterMs;
  const result: PublishEmailNotificationsResult = { sent: 0, failed: 0, claimed: 0 };

  for (let index = 0; index < limit; index += 1) {
    const claim = options.store.claimNextEmailNotification({
      workerId,
      now: now(),
      leaseTtlMs
    });

    if (!claim) {
      break;
    }

    result.claimed += 1;
    const { notification, lease } = claim;

    try {
      await options.sender.send(notification);
      options.store.markEmailNotificationSent({
        notificationId: notification.id,
        leaseId: lease.id,
        workerId,
        now: now()
      });
      recordEmailAudit(options.store, {
        type: "email.notification_sent",
        outcome: "success",
        summary: "Email notification sent.",
        notificationId: notification.id,
        sessionId: notification.sessionId,
        repoId: notification.repoId
      });
      result.sent += 1;
    } catch (error) {
      const message = sanitizeNotificationText(error instanceof Error ? error.message : String(error), 500);
      options.store.markEmailNotificationFailed({
        notificationId: notification.id,
        leaseId: lease.id,
        workerId,
        now: now(),
        error: message,
        retryAfterMs
      });
      recordEmailAudit(options.store, {
        type: "email.notification_failed",
        outcome: "failure",
        summary: "Email notification delivery failed.",
        notificationId: notification.id,
        sessionId: notification.sessionId,
        repoId: notification.repoId
      });
      options.logger?.warn("Email notification delivery failed.", {
        notificationId: notification.id,
        kind: notification.kind,
        error: message
      });
      result.failed += 1;
    }
  }

  return result;
}

export function startEmailNotificationPublisher(
  options: PublishEmailNotificationsOptions & { pollIntervalMs?: number }
): ReturnType<typeof setInterval> {
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const interval = setInterval(() => {
    void publishPendingEmailNotifications(options).catch((error: unknown) => {
      options.logger?.warn("Email notification publisher tick failed.", {
        error: error instanceof Error ? sanitizeNotificationText(error.message, 500) : sanitizeNotificationText(String(error), 500)
      });
    });
  }, pollIntervalMs);

  return interval;
}

function recordEmailAudit(
  store: InMemoryStore,
  input: {
    type: "email.notification_sent" | "email.notification_failed";
    outcome: "success" | "failure";
    summary: string;
    notificationId: string;
    sessionId?: string;
    repoId?: string;
  }
): void {
  store.saveAuditEvent({
    id: nanoid(12),
    at: new Date().toISOString(),
    type: input.type,
    outcome: input.outcome,
    summary: input.summary,
    sessionId: input.sessionId,
    repoId: input.repoId,
    metadata: {
      emailNotificationId: input.notificationId
    }
  });
}
