import { nanoid } from "nanoid";
import type { QueueClaim, QueueJob, RunnerTaskSpec } from "../../../packages/shared/src/types.js";
import type { InMemoryStore } from "./persistence/inMemory.js";
import { createQueueLease } from "./persistence/inMemory.js";

export interface DurableQueueOptions {
  leaseTtlMs?: number;
  sessionConcurrencyLimit?: number;
  repoConcurrencyLimit?: number;
  defaultMaxAttempts?: number;
}

export interface EnqueueRunnerTaskInput {
  repoId: string;
  task: RunnerTaskSpec;
  availableAt?: string;
  maxAttempts?: number;
  now?: Date;
}

export interface ClaimNextInput {
  runnerId: string;
  now?: Date;
}

export interface LeaseMutationInput {
  jobId: string;
  leaseId: string;
  runnerId: string;
  now?: Date;
}

export interface RecoverAbandonedLeasesResult {
  requeued: string[];
  failed: string[];
}

const defaultQueueOptions: Required<DurableQueueOptions> = {
  leaseTtlMs: 60_000,
  sessionConcurrencyLimit: 1,
  repoConcurrencyLimit: 1,
  defaultMaxAttempts: 3
};

export class QueueLeaseExpiredError extends Error {
  constructor(jobId: string) {
    super(`Queue job '${jobId}' lease expired.`);
    this.name = "QueueLeaseExpiredError";
  }
}

export class SerialQueue {
  private tail = Promise.resolve();

  enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

export class DurableQueue {
  private readonly options: Required<DurableQueueOptions>;

  constructor(
    private readonly store: InMemoryStore,
    options: DurableQueueOptions = {}
  ) {
    this.options = { ...defaultQueueOptions, ...options };
  }

  enqueueRunnerTask(input: EnqueueRunnerTaskInput): QueueJob {
    const now = (input.now ?? new Date()).toISOString();
    const job: QueueJob = {
      id: nanoid(12),
      kind: "runner_task",
      status: "queued",
      sessionId: input.task.sessionId,
      repoId: input.repoId,
      taskRunId: input.task.runId,
      payload: input.task,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? this.options.defaultMaxAttempts,
      createdAt: now,
      updatedAt: now,
      availableAt: input.availableAt ?? now
    };

    this.store.saveQueueJob(job);
    return job;
  }

  claimNext(input: ClaimNextInput): QueueClaim | undefined {
    const now = input.now ?? new Date();
    this.recoverAbandonedLeases({ now });
    return this.store.claimNextQueueJob({
      runnerId: input.runnerId,
      now,
      leaseTtlMs: this.options.leaseTtlMs,
      sessionConcurrencyLimit: this.options.sessionConcurrencyLimit,
      repoConcurrencyLimit: this.options.repoConcurrencyLimit
    });
  }

  heartbeat(input: LeaseMutationInput): QueueClaim {
    const now = input.now ?? new Date();
    const job = this.requireLeasedJob(input, now);
    const lease = createQueueLease({
      runnerId: input.runnerId,
      leaseId: input.leaseId,
      claimedAt: job.lease?.claimedAt,
      now,
      leaseTtlMs: this.options.leaseTtlMs
    });

    job.lease = lease;
    job.updatedAt = now.toISOString();
    this.store.saveQueueJob(job);
    return { job, lease };
  }

  complete(input: LeaseMutationInput): QueueJob {
    const now = input.now ?? new Date();
    const job = this.requireLeasedJob(input, now);
    job.status = "completed";
    job.completedAt = now.toISOString();
    job.updatedAt = now.toISOString();
    job.lease = undefined;
    this.store.saveQueueJob(job);
    return job;
  }

  fail(input: LeaseMutationInput & { error: string; retry?: boolean }): QueueJob {
    const now = input.now ?? new Date();
    const job = this.requireLeasedJob(input, now);
    const shouldRetry = input.retry ?? job.attempts < job.maxAttempts;

    if (shouldRetry && job.attempts < job.maxAttempts) {
      job.status = "queued";
      job.availableAt = now.toISOString();
      job.lease = undefined;
      job.error = input.error;
      job.updatedAt = now.toISOString();
      this.store.saveQueueJob(job);
      return job;
    }

    job.status = "failed";
    job.failedAt = now.toISOString();
    job.updatedAt = now.toISOString();
    job.error = input.error;
    job.lease = undefined;
    this.store.saveQueueJob(job);
    return job;
  }

  abandon(input: LeaseMutationInput & { reason: string }): QueueJob {
    return this.fail({ ...input, error: input.reason, retry: true });
  }

  cancel(jobId: string, now = new Date()): QueueJob {
    const job = this.store.getQueueJob(jobId);

    if (!job) {
      throw new Error(`Queue job '${jobId}' was not found.`);
    }

    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return job;
    }

    job.status = "cancelled";
    job.cancelledAt = now.toISOString();
    job.updatedAt = now.toISOString();
    job.lease = undefined;
    this.store.saveQueueJob(job);
    return job;
  }

  recoverAbandonedLeases(input: { now?: Date } = {}): RecoverAbandonedLeasesResult {
    const now = input.now ?? new Date();
    const result: RecoverAbandonedLeasesResult = { requeued: [], failed: [] };

    for (const job of this.store.listQueueJobs()) {
      if (job.status !== "leased" || !job.lease || Date.parse(job.lease.expiresAt) > now.getTime()) {
        continue;
      }

      job.lease = undefined;
      job.updatedAt = now.toISOString();

      if (job.attempts >= job.maxAttempts) {
        job.status = "failed";
        job.failedAt = now.toISOString();
        job.error = "Runner lease expired after maximum attempts.";
        result.failed.push(job.id);
      } else {
        job.status = "queued";
        job.availableAt = now.toISOString();
        job.error = "Runner lease expired and was requeued.";
        result.requeued.push(job.id);
      }

      this.store.saveQueueJob(job);
    }

    return result;
  }

  private requireLeasedJob(input: LeaseMutationInput, now: Date): QueueJob {
    const job = this.store.getQueueJob(input.jobId);

    if (!job) {
      throw new Error(`Queue job '${input.jobId}' was not found.`);
    }

    if (job.status !== "leased" || !job.lease) {
      throw new Error(`Queue job '${job.id}' is not leased.`);
    }

    if (job.lease.id !== input.leaseId || job.lease.runnerId !== input.runnerId) {
      throw new Error(`Queue job '${job.id}' lease does not match the requesting runner.`);
    }

    if (Date.parse(job.lease.expiresAt) <= now.getTime()) {
      throw new QueueLeaseExpiredError(job.id);
    }

    return job;
  }
}
