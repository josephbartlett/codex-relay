import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DurableQueue } from "../apps/orchestrator/src/queue.js";
import { InMemoryStore } from "../apps/orchestrator/src/persistence/inMemory.js";
import { JsonFileStore } from "../apps/orchestrator/src/persistence/jsonFileStore.js";
import { SqliteStore } from "../apps/orchestrator/src/persistence/sqliteStore.js";
import { enqueueSlackNotification } from "../apps/orchestrator/src/slackNotifications.js";
import type { RunnerTaskSpec } from "../packages/shared/src/types.js";

const baseNow = new Date("2026-04-13T00:00:00.000Z");

test("durable queue enqueues and claims available runner tasks", () => {
  const store = new InMemoryStore();
  const queue = new DurableQueue(store, { leaseTtlMs: 1_000 });
  const job = queue.enqueueRunnerTask({
    repoId: "default",
    task: sampleRunnerTask({ runId: "run-1", sessionId: "session-1" }),
    now: baseNow
  });

  const claim = queue.claimNext({ runnerId: "worker-1", now: new Date("2026-04-13T00:00:00.000Z") });

  assert.ok(claim);
  assert.equal(claim.job.id, job.id);
  assert.equal(claim.job.status, "leased");
  assert.equal(claim.job.attempts, 1);
  assert.equal(claim.lease.runnerId, "worker-1");
  assert.equal(claim.lease.expiresAt, "2026-04-13T00:00:01.000Z");
});

test("durable queue skips delayed jobs and enforces session/repo concurrency", () => {
  const store = new InMemoryStore();
  const queue = new DurableQueue(store, {
    sessionConcurrencyLimit: 1,
    repoConcurrencyLimit: 1
  });
  queue.enqueueRunnerTask({
    repoId: "default",
    task: sampleRunnerTask({ runId: "delayed", sessionId: "session-delayed" }),
    availableAt: "2026-04-13T01:00:00.000Z",
    now: baseNow
  });
  queue.enqueueRunnerTask({
    repoId: "default",
    task: sampleRunnerTask({ runId: "run-1", sessionId: "session-1" }),
    now: baseNow
  });
  queue.enqueueRunnerTask({
    repoId: "default",
    task: sampleRunnerTask({ runId: "run-2", sessionId: "session-2" }),
    now: baseNow
  });

  const first = queue.claimNext({ runnerId: "worker-1", now: new Date("2026-04-13T00:00:00.000Z") });
  const second = queue.claimNext({ runnerId: "worker-2", now: new Date("2026-04-13T00:00:00.000Z") });

  assert.equal(first?.job.taskRunId, "run-1");
  assert.equal(second, undefined);
});

test("durable queue heartbeat preserves claimedAt and complete clears lease", () => {
  const store = new InMemoryStore();
  const queue = new DurableQueue(store, { leaseTtlMs: 1_000 });
  queue.enqueueRunnerTask({
    repoId: "default",
    task: sampleRunnerTask({ runId: "run-1", sessionId: "session-1" }),
    now: baseNow
  });
  const claim = queue.claimNext({ runnerId: "worker-1", now: new Date("2026-04-13T00:00:00.000Z") });
  assert.ok(claim);

  const heartbeat = queue.heartbeat({
    jobId: claim.job.id,
    leaseId: claim.lease.id,
    runnerId: "worker-1",
    now: new Date("2026-04-13T00:00:00.500Z")
  });

  assert.equal(heartbeat.lease.claimedAt, "2026-04-13T00:00:00.000Z");
  assert.equal(heartbeat.lease.heartbeatAt, "2026-04-13T00:00:00.500Z");
  assert.equal(heartbeat.lease.expiresAt, "2026-04-13T00:00:01.500Z");

  const completed = queue.complete({
    jobId: claim.job.id,
    leaseId: claim.lease.id,
    runnerId: "worker-1",
    now: new Date("2026-04-13T00:00:01.000Z")
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.lease, undefined);
});

test("durable queue rejects stale lease mutations after expiry", () => {
  const store = new InMemoryStore();
  const queue = new DurableQueue(store, { leaseTtlMs: 1_000 });
  queue.enqueueRunnerTask({
    repoId: "default",
    task: sampleRunnerTask({ runId: "run-1", sessionId: "session-1" }),
    now: baseNow
  });
  const claim = queue.claimNext({ runnerId: "worker-1", now: baseNow });
  assert.ok(claim);

  assert.throws(
    () =>
      queue.complete({
        jobId: claim.job.id,
        leaseId: claim.lease.id,
        runnerId: "worker-1",
        now: new Date("2026-04-13T00:00:01.000Z")
      }),
    /lease expired/
  );

  const recovered = queue.recoverAbandonedLeases({ now: new Date("2026-04-13T00:00:01.000Z") });
  assert.deepEqual(recovered.requeued, [claim.job.id]);
  assert.equal(store.getQueueJob(claim.job.id)?.status, "queued");
});

test("durable queue rejects lease mutations from the wrong runner", () => {
  const store = new InMemoryStore();
  const queue = new DurableQueue(store);
  queue.enqueueRunnerTask({
    repoId: "default",
    task: sampleRunnerTask({ runId: "run-1", sessionId: "session-1" }),
    now: baseNow
  });
  const claim = queue.claimNext({ runnerId: "worker-1" });
  assert.ok(claim);

  assert.throws(
    () =>
      queue.complete({
        jobId: claim.job.id,
        leaseId: claim.lease.id,
        runnerId: "worker-2"
      }),
    /lease does not match/
  );
});

test("durable queue recovers expired leases and fails after max attempts", () => {
  const store = new InMemoryStore();
  const queue = new DurableQueue(store, { leaseTtlMs: 1_000 });
  const requeueJob = queue.enqueueRunnerTask({
    repoId: "default",
    task: sampleRunnerTask({ runId: "run-1", sessionId: "session-1" }),
    maxAttempts: 2,
    now: baseNow
  });
  queue.claimNext({ runnerId: "worker-1", now: new Date("2026-04-13T00:00:00.000Z") });

  const recovered = queue.recoverAbandonedLeases({ now: new Date("2026-04-13T00:00:02.000Z") });
  assert.deepEqual(recovered.requeued, [requeueJob.id]);
  assert.equal(store.getQueueJob(requeueJob.id)?.status, "queued");

  const secondClaim = queue.claimNext({ runnerId: "worker-2", now: new Date("2026-04-13T00:00:03.000Z") });
  assert.ok(secondClaim);
  const failed = queue.recoverAbandonedLeases({ now: new Date("2026-04-13T00:00:05.000Z") });
  assert.deepEqual(failed.failed, [requeueJob.id]);
  assert.equal(store.getQueueJob(requeueJob.id)?.status, "failed");
});

test("durable queue cancel clears active lease and is idempotent", () => {
  const store = new InMemoryStore();
  const queue = new DurableQueue(store);
  const job = queue.enqueueRunnerTask({
    repoId: "default",
    task: sampleRunnerTask({ runId: "run-1", sessionId: "session-1" }),
    now: baseNow
  });
  queue.claimNext({ runnerId: "worker-1" });

  const cancelled = queue.cancel(job.id, new Date("2026-04-13T00:00:00.000Z"));
  const duplicate = queue.cancel(job.id, new Date("2026-04-13T00:00:01.000Z"));

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.lease, undefined);
  assert.equal(duplicate.cancelledAt, "2026-04-13T00:00:00.000Z");
});

test("json store persists queue jobs for single-process compatibility", () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-json-queue-"));

  try {
    const statePath = join(temp, "state.json");
    const store = JsonFileStore.load(statePath);
    const queue = new DurableQueue(store);
    const job = queue.enqueueRunnerTask({
      repoId: "default",
      task: sampleRunnerTask({ runId: "run-1", sessionId: "session-1" }),
      now: baseNow
    });
    queue.claimNext({ runnerId: "worker-1", now: new Date("2026-04-13T00:00:00.000Z") });

    const reloaded = JsonFileStore.load(statePath);
    assert.equal(reloaded.getQueueJob(job.id)?.status, "leased");
    assert.equal(reloaded.getQueueJob(job.id)?.lease?.runnerId, "worker-1");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("sqlite store persists queue jobs and claims atomically", () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-sqlite-queue-"));

  try {
    const databasePath = join(temp, "state.db");
    const store = SqliteStore.load({ databasePath });
    const queue = new DurableQueue(store);
    const job = queue.enqueueRunnerTask({
      repoId: "default",
      task: sampleRunnerTask({ runId: "run-1", sessionId: "session-1" }),
      now: baseNow
    });
    const first = queue.claimNext({ runnerId: "worker-1", now: new Date("2026-04-13T00:00:00.000Z") });
    const secondStore = SqliteStore.load({ databasePath });
    const secondQueue = new DurableQueue(secondStore);
    const second = secondQueue.claimNext({ runnerId: "worker-2", now: new Date("2026-04-13T00:00:00.000Z") });

    assert.equal(first?.job.id, job.id);
    assert.equal(second, undefined);
    assert.equal(secondStore.getQueueJob(job.id)?.lease?.runnerId, "worker-1");
    store.close();
    secondStore.close();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("json store persists Slack notifications for single-process delivery", () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-json-slack-notifications-"));

  try {
    const statePath = join(temp, "state.json");
    const store = JsonFileStore.load(statePath);
    const notification = enqueueSlackNotification(store, {
      kind: "runner.started",
      severity: "info",
      slackThreadKey: "T1:C1:1000.1",
      sessionId: "session-1",
      repoId: "default",
      taskRunId: "run-1",
      queueJobId: "job-1",
      title: "Queued task running",
      detail: "Mode: implement",
      now: baseNow
    });

    const claim = store.claimNextSlackNotification({
      workerId: "publisher-1",
      now: baseNow,
      leaseTtlMs: 60_000
    });
    assert.equal(claim?.notification.id, notification.id);

    const reloaded = JsonFileStore.load(statePath);
    assert.equal(reloaded.getSlackNotification(notification.id)?.status, "leased");
    assert.equal(reloaded.getSlackNotification(notification.id)?.lease?.workerId, "publisher-1");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("sqlite store claims Slack notifications atomically", () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-sqlite-slack-notifications-"));

  try {
    const databasePath = join(temp, "state.db");
    const store = SqliteStore.load({ databasePath });
    const notification = enqueueSlackNotification(store, {
      kind: "runner.started",
      severity: "info",
      slackThreadKey: "T1:C1:1000.1",
      sessionId: "session-1",
      repoId: "default",
      taskRunId: "run-1",
      queueJobId: "job-1",
      title: "Queued task running",
      detail: "Mode: implement",
      now: baseNow
    });
    const first = store.claimNextSlackNotification({
      workerId: "publisher-1",
      now: baseNow,
      leaseTtlMs: 60_000
    });
    const secondStore = SqliteStore.load({ databasePath });
    const second = secondStore.claimNextSlackNotification({
      workerId: "publisher-2",
      now: baseNow,
      leaseTtlMs: 60_000
    });

    assert.equal(first?.notification.id, notification.id);
    assert.equal(second, undefined);
    assert.equal(secondStore.getSlackNotification(notification.id)?.lease?.workerId, "publisher-1");
    store.close();
    secondStore.close();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

function sampleRunnerTask(overrides: Partial<RunnerTaskSpec> = {}): RunnerTaskSpec {
  return {
    runId: "run-1",
    sessionId: "session-1",
    mode: "plan",
    prompt: "inspect",
    workspacePath: "/tmp/worktree",
    sandbox: "read-only",
    approvalPolicy: "never",
    ...overrides
  };
}
