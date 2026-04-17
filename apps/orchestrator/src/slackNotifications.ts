import { nanoid } from "nanoid";
import type {
  SlackNotification,
  SlackNotificationKind,
  SlackNotificationSeverity,
  SlackThreadKey
} from "../../../packages/shared/src/types.js";
import type { InMemoryStore } from "./persistence/inMemory.js";

export interface EnqueueSlackNotificationInput {
  kind: SlackNotificationKind;
  severity: SlackNotificationSeverity;
  slackThreadKey: SlackThreadKey;
  sessionId: string;
  repoId?: string;
  taskRunId?: string;
  approvalId?: string;
  queueJobId?: string;
  title: string;
  detail: string;
  now?: Date;
  maxAttempts?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export function enqueueSlackNotification(
  store: InMemoryStore,
  input: EnqueueSlackNotificationInput
): SlackNotification {
  const existing = findExistingNotification(store, input);

  if (existing) {
    return existing;
  }

  const now = (input.now ?? new Date()).toISOString();
  const notification: SlackNotification = {
    id: nanoid(12),
    kind: input.kind,
    status: "pending",
    severity: input.severity,
    slackThreadKey: input.slackThreadKey,
    sessionId: input.sessionId,
    repoId: input.repoId,
    taskRunId: input.taskRunId,
    approvalId: input.approvalId,
    queueJobId: input.queueJobId,
    title: sanitizeNotificationText(input.title, 160),
    detail: sanitizeNotificationText(input.detail, 1200),
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    createdAt: now,
    updatedAt: now,
    availableAt: now,
    metadata: input.metadata ?? {}
  };

  store.saveSlackNotification(notification);
  return notification;
}

export function sanitizeNotificationText(value: string, maxLength = 1200): string {
  const normalized = value
    .replace(/\[([^\]\n]{1,200})\]\(((?:file:\/\/\/)?(?:[A-Za-z]:[\\/]|\/(?:mnt\/[A-Za-z]\/|Users\/|home\/|tmp\/|var\/folders\/|private\/var\/))[^)\n]*)\)/gu, "$1")
    .replace(/(^|[\s([{"'`])(?:file:\/\/\/(?:[A-Za-z]:[\\/]|\/?(?:mnt\/[A-Za-z]\/|Users\/|home\/|tmp\/|var\/folders\/|private\/var\/))[^\s)\]}"'`<>]*)/gu, "$1[local-path]")
    .replace(/(^|[\s([{"'`])(?:[A-Za-z]:[\\/][^\s)\]}"'`<>]*)/gu, "$1[local-path]")
    .replace(/(^|[\s([{"'`])(?:\/(?:mnt\/[A-Za-z]\/|Users\/|home\/|tmp\/|var\/folders\/|private\/var\/)[^\s)\]}"'`<>]*)/gu, "$1[local-path]")
    .replace(/xox[abprs]-[A-Za-z0-9-]+/g, "[redacted-slack-token]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted-github-token]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-token]")
    .replace(/\0/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 20))}\n... truncated ...`;
}

function findExistingNotification(
  store: InMemoryStore,
  input: EnqueueSlackNotificationInput
): SlackNotification | undefined {
  return store.listSlackNotifications().find((notification) => {
    if (notification.kind !== input.kind || notification.sessionId !== input.sessionId) {
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

    return false;
  });
}
