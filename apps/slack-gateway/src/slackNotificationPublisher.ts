import type { SlackNotification } from "../../../packages/shared/src/types.js";
import type { Logger } from "../../../packages/shared/src/logging.js";
import type { InMemoryStore } from "../../orchestrator/src/persistence/inMemory.js";
import { sanitizeNotificationText } from "../../orchestrator/src/slackNotifications.js";
import { failureBlocks, planBlocks, progressBlocks, sessionSummaryBlocks, type SlackBlock } from "./blocks/taskCards.js";

export interface SlackNotificationClient {
  chat: {
    postMessage(input: {
      channel: string;
      thread_ts: string;
      text: string;
      blocks: SlackBlock[];
    }): Promise<unknown>;
  };
}

export interface PublishSlackNotificationsOptions {
  store: InMemoryStore;
  client: SlackNotificationClient;
  logger?: Logger;
  workerId?: string;
  now?: () => Date;
  limit?: number;
  leaseTtlMs?: number;
  retryAfterMs?: number;
}

export interface PublishSlackNotificationsResult {
  sent: number;
  failed: number;
  claimed: number;
}

const defaultWorkerId = `slack-publisher-${process.pid}`;
const defaultLimit = 10;
const defaultLeaseTtlMs = 60_000;
const defaultRetryAfterMs = 15_000;

export async function publishPendingSlackNotifications(
  options: PublishSlackNotificationsOptions
): Promise<PublishSlackNotificationsResult> {
  const workerId = options.workerId ?? defaultWorkerId;
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? defaultLimit;
  const leaseTtlMs = options.leaseTtlMs ?? defaultLeaseTtlMs;
  const retryAfterMs = options.retryAfterMs ?? defaultRetryAfterMs;
  const result: PublishSlackNotificationsResult = { sent: 0, failed: 0, claimed: 0 };

  for (let index = 0; index < limit; index += 1) {
    const claim = options.store.claimNextSlackNotification({
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
      const thread = parseSlackThreadKey(notification.slackThreadKey);
      await options.client.chat.postMessage({
        channel: thread.channelId,
        thread_ts: thread.threadTs,
        text: notification.title,
        blocks: renderNotificationBlocks(options.store, notification)
      });
      options.store.markSlackNotificationSent({
        notificationId: notification.id,
        leaseId: lease.id,
        workerId,
        now: now()
      });
      result.sent += 1;
    } catch (error) {
      const message = sanitizeNotificationText(error instanceof Error ? error.message : String(error), 500);
      options.store.markSlackNotificationFailed({
        notificationId: notification.id,
        leaseId: lease.id,
        workerId,
        now: now(),
        error: message,
        retryAfterMs
      });
      options.logger?.warn("Slack notification delivery failed.", {
        notificationId: notification.id,
        kind: notification.kind,
        error: message
      });
      result.failed += 1;
    }
  }

  return result;
}

export function startSlackNotificationPublisher(
  options: PublishSlackNotificationsOptions & { pollIntervalMs?: number }
): ReturnType<typeof setInterval> {
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const interval = setInterval(() => {
    void publishPendingSlackNotifications(options).catch((error: unknown) => {
      options.logger?.warn("Slack notification publisher tick failed.", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }, pollIntervalMs);

  interval.unref?.();
  return interval;
}

function renderNotificationBlocks(store: InMemoryStore, notification: SlackNotification): SlackBlock[] {
  if (notification.kind === "plan.ready" && notification.approvalId) {
    const approval = store.approvals.get(notification.approvalId);

    if (approval) {
      return planBlocks(approval);
    }
  }

  if (notification.kind === "runner.completed") {
    const session = store.sessions.get(notification.sessionId);

    if (session) {
      return sessionSummaryBlocks({
        session,
        title: notification.title,
        detail: notification.detail
      });
    }
  }

  if (notification.severity === "failure") {
    return failureBlocks({ title: notification.title, error: notification.detail });
  }

  return progressBlocks({ title: notification.title, detail: notification.detail });
}

function parseSlackThreadKey(threadKey: `${string}:${string}:${string}`): {
  teamId: string;
  channelId: string;
  threadTs: string;
} {
  const [teamId, channelId, threadTs] = threadKey.split(":");

  if (!teamId || !channelId || !threadTs) {
    throw new Error(`Invalid Slack thread key: ${threadKey}`);
  }

  return { teamId, channelId, threadTs };
}
