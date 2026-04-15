import type { HarnessConfig } from "../../../packages/shared/src/config.js";
import type { Logger } from "../../../packages/shared/src/logging.js";
import type { InMemoryStore } from "../../orchestrator/src/persistence/inMemory.js";
import { sanitizeNotificationText } from "../../orchestrator/src/slackNotifications.js";
import type { EmailMailboxClientFactory, MailboxMessageRef } from "./imap.js";
import { createImapMailboxClientFactory } from "./imap.js";
import { processInboundEmailMessage, type ProcessInboundEmailResult } from "./tasks.js";

export interface PollInboundEmailOptions {
  config: HarnessConfig;
  store: InMemoryStore;
  mailboxFactory?: EmailMailboxClientFactory;
  logger?: Logger;
  now?: () => Date;
}

export interface PollInboundEmailResult {
  fetched: number;
  queued: number;
  rejected: number;
  ignored: number;
  failed: number;
  duplicates: number;
  markedProcessed: number;
}

export async function pollInboundEmailOnce(options: PollInboundEmailOptions): Promise<PollInboundEmailResult> {
  const imap = options.config.email?.imap;

  if (!options.config.email?.enabled || !imap?.enabled) {
    return emptyResult();
  }

  const mailboxFactory = options.mailboxFactory ?? createImapMailboxClientFactory(imap);
  const result = emptyResult();
  const mailbox = await mailboxFactory().catch((error: unknown) => {
    result.failed += 1;
    options.logger?.warn("Inbound email mailbox connection failed.", {
      error: error instanceof Error ? sanitizeNotificationText(error.message, 500) : sanitizeNotificationText(String(error), 500)
    });
    return undefined;
  });

  if (!mailbox) {
    return result;
  }

  try {
    const messages = await mailbox.fetchUnread(imap.maxMessages);
    result.fetched = messages.length;

    for (const message of messages) {
      const processed = await processInboundEmailMessage({
        config: options.config,
        store: options.store,
        message,
        now: options.now?.() ?? new Date()
      });
      incrementResult(result, processed);

      if (imap.markSeen && shouldMarkProcessed(processed)) {
        await mailbox.markProcessed(messageRef(message));
        result.markedProcessed += 1;
      }
    }
  } catch (error) {
    result.failed += 1;
    options.logger?.warn("Inbound email poll failed.", {
      error: error instanceof Error ? sanitizeNotificationText(error.message, 500) : sanitizeNotificationText(String(error), 500)
    });
  } finally {
    await mailbox.close().catch((error: unknown) => {
      options.logger?.warn("Inbound email mailbox close failed.", {
        error: error instanceof Error ? sanitizeNotificationText(error.message, 500) : sanitizeNotificationText(String(error), 500)
      });
    });
  }

  return result;
}

export function startInboundEmailPoller(
  options: PollInboundEmailOptions & { pollIntervalMs?: number }
): ReturnType<typeof setInterval> {
  const pollIntervalMs = options.pollIntervalMs ?? options.config.email?.imap.pollIntervalMs ?? 10_000;
  const interval = setInterval(() => {
    void pollInboundEmailOnce(options).catch((error: unknown) => {
      options.logger?.warn("Inbound email poller tick failed.", {
        error: error instanceof Error ? sanitizeNotificationText(error.message, 500) : sanitizeNotificationText(String(error), 500)
      });
    });
  }, pollIntervalMs);

  return interval;
}

function emptyResult(): PollInboundEmailResult {
  return {
    fetched: 0,
    queued: 0,
    rejected: 0,
    ignored: 0,
    failed: 0,
    duplicates: 0,
    markedProcessed: 0
  };
}

function incrementResult(result: PollInboundEmailResult, processed: ProcessInboundEmailResult): void {
  if (processed.kind === "duplicate") {
    result.duplicates += 1;
    return;
  }

  result[processed.kind] += 1;
}

function shouldMarkProcessed(processed: ProcessInboundEmailResult): boolean {
  return processed.kind === "queued" || processed.kind === "rejected" || processed.kind === "ignored" || processed.kind === "duplicate";
}

function messageRef(message: MailboxMessageRef): MailboxMessageRef {
  return {
    uid: message.uid,
    messageId: message.messageId
  };
}
