import { nanoid } from "nanoid";
import type {
  EmailNotification,
  EmailNotificationKind,
  EmailNotificationSeverity
} from "../../../packages/shared/src/types.js";
import type { InMemoryStore } from "./persistence/inMemory.js";
import { sanitizeNotificationText } from "./slackNotifications.js";

export interface EnqueueEmailNotificationInput {
  kind: EmailNotificationKind;
  severity: EmailNotificationSeverity;
  to: string[];
  subject: string;
  text: string;
  sessionId?: string;
  repoId?: string;
  taskRunId?: string;
  approvalId?: string;
  queueJobId?: string;
  now?: Date;
  maxAttempts?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export function enqueueEmailNotification(
  store: InMemoryStore,
  input: EnqueueEmailNotificationInput
): EmailNotification {
  const existing = findExistingNotification(store, input);

  if (existing) {
    return existing;
  }

  const now = (input.now ?? new Date()).toISOString();
  const notification: EmailNotification = {
    id: nanoid(12),
    kind: input.kind,
    status: "pending",
    severity: input.severity,
    to: input.to.map((recipient) => recipient.trim()).filter(Boolean),
    subject: sanitizeEmailSubject(input.subject),
    text: sanitizeNotificationText(input.text, 4000),
    sessionId: input.sessionId,
    repoId: input.repoId,
    taskRunId: input.taskRunId,
    approvalId: input.approvalId,
    queueJobId: input.queueJobId,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    createdAt: now,
    updatedAt: now,
    availableAt: now,
    metadata: input.metadata ?? {}
  };

  store.saveEmailNotification(notification);
  return notification;
}

export function sanitizeEmailSubject(value: string, maxLength = 140): string {
  const normalized = sanitizeNotificationText(value, maxLength)
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s{2,}/gu, " ")
    .trim();

  return normalized || "Codex Relay notification";
}

function findExistingNotification(
  store: InMemoryStore,
  input: EnqueueEmailNotificationInput
): EmailNotification | undefined {
  return store.listEmailNotifications().find((notification) => {
    if (notification.kind !== input.kind) {
      return false;
    }

    if (notification.to.join(",") !== input.to.map((recipient) => recipient.trim()).filter(Boolean).join(",")) {
      return false;
    }

    if (input.approvalId) {
      return notification.approvalId === input.approvalId;
    }

    if (input.queueJobId) {
      return notification.queueJobId === input.queueJobId;
    }

    if (input.taskRunId) {
      return notification.taskRunId === input.taskRunId;
    }

    if (input.metadata?.emailInboundId) {
      return notification.metadata?.emailInboundId === input.metadata.emailInboundId;
    }

    return notification.subject === sanitizeEmailSubject(input.subject);
  });
}
