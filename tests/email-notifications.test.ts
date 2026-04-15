import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishPendingEmailNotifications } from "../apps/email-gateway/src/notificationPublisher.js";
import type { EmailSender } from "../apps/email-gateway/src/smtp.js";
import { enqueueEmailNotification } from "../apps/orchestrator/src/emailNotifications.js";
import { InMemoryStore } from "../apps/orchestrator/src/persistence/inMemory.js";
import { JsonFileStore } from "../apps/orchestrator/src/persistence/jsonFileStore.js";
import { SqliteStore } from "../apps/orchestrator/src/persistence/sqliteStore.js";
import type { EmailNotification } from "../packages/shared/src/types.js";

const baseNow = new Date("2026-04-15T00:00:00.000Z");

class FakeEmailSender implements EmailSender {
  readonly sent: EmailNotification[] = [];
  failures: Error[] = [];

  async send(notification: EmailNotification): Promise<void> {
    const failure = this.failures.shift();

    if (failure) {
      throw failure;
    }

    this.sent.push(notification);
  }
}

test("email notifications enqueue once per lifecycle recipient scope", () => {
  const store = new InMemoryStore();
  const first = enqueueEmailNotification(store, sampleNotificationInput());
  const second = enqueueEmailNotification(store, sampleNotificationInput());

  assert.equal(first.id, second.id);
  assert.equal(store.listEmailNotifications().length, 1);
  assert.equal(first.subject, "Codex Relay completed");
  assert.deepEqual(first.to, ["operator@example.test"]);
});

test("email publisher sends pending notifications once", async () => {
  const store = new InMemoryStore();
  const sender = new FakeEmailSender();
  const notification = enqueueEmailNotification(store, sampleNotificationInput());

  const first = await publishPendingEmailNotifications({
    store,
    sender,
    workerId: "email-worker-1",
    now: () => baseNow
  });
  const second = await publishPendingEmailNotifications({
    store,
    sender,
    workerId: "email-worker-1",
    now: () => baseNow
  });

  assert.deepEqual(first, { sent: 1, failed: 0, claimed: 1 });
  assert.deepEqual(second, { sent: 0, failed: 0, claimed: 0 });
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0]?.id, notification.id);
  assert.equal(store.getEmailNotification(notification.id)?.status, "sent");
});

test("email publisher retries failed delivery without leaking token-shaped errors", async () => {
  const store = new InMemoryStore();
  const sender = new FakeEmailSender();
  sender.failures = [new Error("SMTP rejected xoxb-1234567890-secret ghp_sensitive123 sk-sensitive123")];
  const notification = enqueueEmailNotification(store, sampleNotificationInput());

  const failed = await publishPendingEmailNotifications({
    store,
    sender,
    workerId: "email-worker-1",
    now: () => baseNow,
    retryAfterMs: 1_000
  });
  const firstError = store.getEmailNotification(notification.id)?.error ?? "";
  const immediateRetry = await publishPendingEmailNotifications({
    store,
    sender,
    workerId: "email-worker-1",
    now: () => baseNow,
    retryAfterMs: 1_000
  });
  const retried = await publishPendingEmailNotifications({
    store,
    sender,
    workerId: "email-worker-1",
    now: () => new Date("2026-04-15T00:00:01.000Z"),
    retryAfterMs: 1_000
  });

  assert.deepEqual(failed, { sent: 0, failed: 1, claimed: 1 });
  assert.deepEqual(immediateRetry, { sent: 0, failed: 0, claimed: 0 });
  assert.deepEqual(retried, { sent: 1, failed: 0, claimed: 1 });
  assert.match(firstError, /\[redacted-slack-token\]/);
  assert.match(firstError, /\[redacted-github-token\]/);
  assert.match(firstError, /\[redacted-token\]/);
  assert.doesNotMatch(firstError, /xoxb-1234567890-secret/u);
  assert.doesNotMatch(firstError, /ghp_sensitive123/u);
  assert.doesNotMatch(firstError, /sk-sensitive123/u);
});

test("email notification subject strips control characters and newlines", () => {
  const store = new InMemoryStore();
  const notification = enqueueEmailNotification(store, {
    ...sampleNotificationInput(),
    subject: "Codex Relay\nBCC: attacker@example.test\u0000"
  });

  assert.equal(notification.subject, "Codex Relay BCC: attacker@example.test");
});

test("json store persists email notifications", () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-email-json-"));

  try {
    const statePath = join(temp, "state.json");
    const store = JsonFileStore.load(statePath);
    const notification = enqueueEmailNotification(store, sampleNotificationInput());
    const reloaded = JsonFileStore.load(statePath);

    assert.equal(reloaded.getEmailNotification(notification.id)?.subject, "Codex Relay completed");
    assert.equal(reloaded.getEmailNotification(notification.id)?.status, "pending");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("sqlite store claims email notifications once", () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-email-sqlite-"));

  try {
    const databasePath = join(temp, "state.db");
    const store = SqliteStore.load({ databasePath });
    const notification = enqueueEmailNotification(store, sampleNotificationInput());
    const first = store.claimNextEmailNotification({
      workerId: "email-worker-1",
      now: baseNow,
      leaseTtlMs: 60_000
    });
    const second = store.claimNextEmailNotification({
      workerId: "email-worker-2",
      now: baseNow,
      leaseTtlMs: 60_000
    });

    assert.equal(first?.notification.id, notification.id);
    assert.equal(second, undefined);
    assert.equal(store.getEmailNotification(notification.id)?.status, "leased");
    store.close();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

function sampleNotificationInput() {
  return {
    kind: "runner.completed" as const,
    severity: "success" as const,
    to: ["operator@example.test"],
    subject: "Codex Relay completed",
    text: "Summary: done",
    sessionId: "session-1",
    repoId: "default",
    taskRunId: "run-1",
    queueJobId: "job-1",
    now: baseNow
  };
}
