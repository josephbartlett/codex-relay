import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  ApprovalRequest,
  AuditEvent,
  QueueClaim,
  QueueJob,
  Session,
  SlackNotification,
  SlackNotificationClaim,
  TaskRun
} from "../../../../packages/shared/src/types.js";
import {
  createQueueLease,
  createSlackNotificationLease,
  InMemoryStore,
  type QueueClaimInput,
  type SlackNotificationClaimInput
} from "./inMemory.js";
import {
  normalizeAuditEvent,
  normalizeApproval,
  normalizeQueueJob,
  normalizeSession,
  normalizeSlackNotification,
  normalizeTaskRun,
  type PersistedState
} from "./stateNormalization.js";

interface SqliteStoreLoadOptions {
  databasePath: string;
  migrateFromJsonPath?: string;
}

type RecordRow = { data: string };

export class SqliteStore extends InMemoryStore {
  private constructor(private readonly db: Database.Database) {
    super();
  }

  static load(options: SqliteStoreLoadOptions): SqliteStore {
    mkdirSync(dirname(options.databasePath), { recursive: true });

    const db = new Database(options.databasePath);
    const store = new SqliteStore(db);
    store.initializeSchema();
    store.loadFromDatabase();

    if (store.isEmpty() && options.migrateFromJsonPath && existsSync(options.migrateFromJsonPath)) {
      store.loadFromJson(options.migrateFromJsonPath);
      store.flush();
    }

    return store;
  }

  override saveSession(session: Session): void {
    super.saveSession(session);
    this.upsert("sessions", session.id, session);
  }

  override saveTaskRun(run: TaskRun): void {
    super.saveTaskRun(run);
    this.upsert("task_runs", run.id, run);
  }

  override saveApproval(approval: ApprovalRequest): void {
    super.saveApproval(approval);
    this.upsert("approvals", approval.id, approval);
  }

  override saveAuditEvent(event: AuditEvent): void {
    super.saveAuditEvent(event);
    this.upsert("audit_events", event.id, event);
  }

  override saveQueueJob(job: QueueJob): void {
    super.saveQueueJob(job);
    this.upsert("queue_jobs", job.id, job);
  }

  override saveSlackNotification(notification: SlackNotification): void {
    super.saveSlackNotification(notification);
    this.upsert("slack_notifications", notification.id, notification);
  }

  override getQueueJob(id: string): QueueJob | undefined {
    const row = this.db.prepare("SELECT data FROM queue_jobs WHERE id = ?").get(id) as RecordRow | undefined;

    if (!row) {
      return undefined;
    }

    const job = normalizeQueueJob(JSON.parse(row.data) as QueueJob);
    this.queueJobs.set(job.id, job);
    return job;
  }

  override listQueueJobs(): QueueJob[] {
    const jobs = (this.db.prepare("SELECT data FROM queue_jobs ORDER BY created_at ASC").all() as RecordRow[])
      .map((row) => normalizeQueueJob(JSON.parse(row.data) as QueueJob));

    this.queueJobs.clear();

    for (const job of jobs) {
      this.queueJobs.set(job.id, job);
    }

    return jobs;
  }

  override getSlackNotification(id: string): SlackNotification | undefined {
    const row = this.db.prepare("SELECT data FROM slack_notifications WHERE id = ?").get(id) as RecordRow | undefined;

    if (!row) {
      return undefined;
    }

    const notification = normalizeSlackNotification(JSON.parse(row.data) as SlackNotification);
    this.slackNotifications.set(notification.id, notification);
    return notification;
  }

  override listSlackNotifications(): SlackNotification[] {
    const notifications = (
      this.db.prepare("SELECT data FROM slack_notifications ORDER BY updated_at ASC").all() as RecordRow[]
    ).map((row) => normalizeSlackNotification(JSON.parse(row.data) as SlackNotification));

    this.slackNotifications.clear();

    for (const notification of notifications) {
      this.slackNotifications.set(notification.id, notification);
    }

    return notifications;
  }

  override claimNextQueueJob(input: QueueClaimInput): QueueClaim | undefined {
    this.db.exec("BEGIN IMMEDIATE");

    try {
      const rows = this.db
        .prepare(
          "SELECT data FROM queue_jobs WHERE status = 'queued' AND available_at <= ? ORDER BY available_at ASC, updated_at ASC"
        )
        .all(input.now.toISOString()) as RecordRow[];

      for (const row of rows) {
        const job = normalizeQueueJob(JSON.parse(row.data) as QueueJob);

        if (!this.canClaimQueueJob(job, input)) {
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
        this.upsert("queue_jobs", job.id, job);
        this.queueJobs.set(job.id, job);
        this.db.exec("COMMIT");
        return { job, lease };
      }

      this.db.exec("COMMIT");
      return undefined;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  override claimNextSlackNotification(input: SlackNotificationClaimInput): SlackNotificationClaim | undefined {
    this.db.exec("BEGIN IMMEDIATE");

    try {
      const rows = this.db
        .prepare(
          "SELECT data FROM slack_notifications WHERE status IN ('pending', 'leased') ORDER BY available_at ASC, updated_at ASC"
        )
        .all() as RecordRow[];

      for (const row of rows) {
        const notification = normalizeSlackNotification(JSON.parse(row.data) as SlackNotification);
        const expiredLease =
          notification.status === "leased" &&
          notification.lease &&
          Date.parse(notification.lease.expiresAt) <= input.now.getTime();
        const pending =
          notification.status === "pending" && Date.parse(notification.availableAt) <= input.now.getTime();

        if (!pending && !expiredLease) {
          continue;
        }

        if (expiredLease && notification.attempts >= notification.maxAttempts) {
          notification.status = "failed";
          notification.failedAt = input.now.toISOString();
          notification.updatedAt = input.now.toISOString();
          notification.error =
            notification.error ?? "Slack notification delivery lease expired after maximum attempts.";
          notification.lease = undefined;
          this.upsert("slack_notifications", notification.id, notification);
          this.slackNotifications.set(notification.id, notification);
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
        this.upsert("slack_notifications", notification.id, notification);
        this.slackNotifications.set(notification.id, notification);
        this.db.exec("COMMIT");
        return { notification, lease };
      }

      this.db.exec("COMMIT");
      return undefined;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  flush(): void {
    this.db.exec("BEGIN IMMEDIATE");

    try {
      this.db.prepare("DELETE FROM sessions").run();
      this.db.prepare("DELETE FROM task_runs").run();
      this.db.prepare("DELETE FROM approvals").run();
      this.db.prepare("DELETE FROM audit_events").run();
      this.db.prepare("DELETE FROM queue_jobs").run();
      this.db.prepare("DELETE FROM slack_notifications").run();

      const sessionInsert = this.db.prepare(
        "INSERT INTO sessions (id, slack_thread_key, owner_slack_user_id, status, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const taskRunInsert = this.db.prepare(
        "INSERT INTO task_runs (id, session_id, status, completed_at, data) VALUES (?, ?, ?, ?, ?)"
      );
      const approvalInsert = this.db.prepare(
        "INSERT INTO approvals (id, session_id, task_run_id, status, expires_at, data) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const auditEventInsert = this.db.prepare(
        "INSERT INTO audit_events (id, at, type, outcome, actor_slack_user_id, session_id, repo_id, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      const queueJobInsert = this.db.prepare(
        "INSERT INTO queue_jobs (id, kind, status, session_id, repo_id, task_run_id, created_at, available_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      const slackNotificationInsert = this.db.prepare(
        "INSERT INTO slack_notifications (id, kind, status, slack_thread_key, session_id, repo_id, task_run_id, queue_job_id, available_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );

      for (const session of this.sessions.values()) {
        sessionInsert.run(
          session.id,
          session.slackThreadKey,
          session.ownerSlackUserId,
          session.status,
          session.updatedAt,
          JSON.stringify(session)
        );
      }

      for (const run of this.taskRuns.values()) {
        taskRunInsert.run(run.id, run.sessionId, run.status, run.completedAt ?? null, JSON.stringify(run));
      }

      for (const approval of this.approvals.values()) {
        approvalInsert.run(
          approval.id,
          approval.sessionId,
          approval.taskRunId,
          approval.status,
          approval.expiresAt,
          JSON.stringify(approval)
        );
      }

      for (const event of this.auditEvents.values()) {
        auditEventInsert.run(
          event.id,
          event.at,
          event.type,
          event.outcome,
          event.actorSlackUserId ?? null,
          event.sessionId ?? null,
          event.repoId ?? null,
          JSON.stringify(event)
        );
      }

      for (const job of this.queueJobs.values()) {
        queueJobInsert.run(
          job.id,
          job.kind,
          job.status,
          job.sessionId,
          job.repoId,
          job.taskRunId ?? null,
          job.createdAt,
          job.availableAt,
          job.updatedAt,
          JSON.stringify(job)
        );
      }

      for (const notification of this.slackNotifications.values()) {
        slackNotificationInsert.run(
          notification.id,
          notification.kind,
          notification.status,
          notification.slackThreadKey,
          notification.sessionId,
          notification.repoId ?? null,
          notification.taskRunId ?? null,
          notification.queueJobId ?? null,
          notification.availableAt,
          notification.updatedAt,
          JSON.stringify(notification)
        );
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        slack_thread_key TEXT NOT NULL UNIQUE,
        owner_slack_user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        completed_at TEXT,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        type TEXT NOT NULL,
        outcome TEXT NOT NULL,
        actor_slack_user_id TEXT,
        session_id TEXT,
        repo_id TEXT,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS queue_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        session_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        task_run_id TEXT,
        created_at TEXT NOT NULL,
        available_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS slack_notifications (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        slack_thread_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        repo_id TEXT,
        task_run_id TEXT,
        queue_job_id TEXT,
        available_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_runs_session_id ON task_runs (session_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_session_id ON approvals (session_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_status_expiry ON approvals (status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_audit_events_at ON audit_events (at);
      CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (actor_slack_user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_events_session ON audit_events (session_id);
      CREATE INDEX IF NOT EXISTS idx_queue_jobs_claim ON queue_jobs (status, available_at, updated_at);
      CREATE INDEX IF NOT EXISTS idx_queue_jobs_session_status ON queue_jobs (session_id, status);
      CREATE INDEX IF NOT EXISTS idx_queue_jobs_repo_status ON queue_jobs (repo_id, status);
      CREATE INDEX IF NOT EXISTS idx_slack_notifications_claim ON slack_notifications (status, available_at, updated_at);
      CREATE INDEX IF NOT EXISTS idx_slack_notifications_thread ON slack_notifications (slack_thread_key);
      CREATE INDEX IF NOT EXISTS idx_slack_notifications_session ON slack_notifications (session_id);
    `);
    this.db
      .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '3')")
      .run();
  }

  private loadFromDatabase(): void {
    for (const row of this.db.prepare("SELECT data FROM sessions").all() as RecordRow[]) {
      const raw = JSON.parse(row.data) as Session;
      const session = normalizeSession(raw);
      this.sessions.set(session.id, session);
      this.sessionIdsByThread.set(session.slackThreadKey, session.id);

      if (JSON.stringify(session) !== JSON.stringify(raw)) {
        this.upsert("sessions", session.id, session);
      }
    }

    for (const row of this.db.prepare("SELECT data FROM task_runs").all() as RecordRow[]) {
      const raw = JSON.parse(row.data) as TaskRun;
      const taskRun = normalizeTaskRun(raw);
      this.taskRuns.set(taskRun.id, taskRun);

      if (JSON.stringify(taskRun) !== JSON.stringify(raw)) {
        this.upsert("task_runs", taskRun.id, taskRun);
      }
    }

    for (const row of this.db.prepare("SELECT data FROM approvals").all() as RecordRow[]) {
      const raw = JSON.parse(row.data) as ApprovalRequest;
      const approval = normalizeApproval(raw);
      this.approvals.set(approval.id, approval);

      if (JSON.stringify(approval) !== JSON.stringify(raw)) {
        this.upsert("approvals", approval.id, approval);
      }
    }

    for (const row of this.db.prepare("SELECT data FROM audit_events").all() as RecordRow[]) {
      const raw = JSON.parse(row.data) as AuditEvent;
      const event = normalizeAuditEvent(raw);
      this.auditEvents.set(event.id, event);

      if (JSON.stringify(event) !== JSON.stringify(raw)) {
        this.upsert("audit_events", event.id, event);
      }
    }

    for (const row of this.db.prepare("SELECT data FROM queue_jobs").all() as RecordRow[]) {
      const raw = JSON.parse(row.data) as QueueJob;
      const job = normalizeQueueJob(raw);
      this.queueJobs.set(job.id, job);

      if (JSON.stringify(job) !== JSON.stringify(raw)) {
        this.upsert("queue_jobs", job.id, job);
      }
    }

    for (const row of this.db.prepare("SELECT data FROM slack_notifications").all() as RecordRow[]) {
      const raw = JSON.parse(row.data) as SlackNotification;
      const notification = normalizeSlackNotification(raw);
      this.slackNotifications.set(notification.id, notification);

      if (JSON.stringify(notification) !== JSON.stringify(raw)) {
        this.upsert("slack_notifications", notification.id, notification);
      }
    }
  }

  private loadFromJson(jsonPath: string): void {
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as PersistedState;

    for (const session of parsed.sessions ?? []) {
      const normalized = normalizeSession(session);
      this.sessions.set(normalized.id, normalized);
      this.sessionIdsByThread.set(normalized.slackThreadKey, normalized.id);
    }

    for (const taskRun of parsed.taskRuns ?? []) {
      const normalized = normalizeTaskRun(taskRun);
      this.taskRuns.set(normalized.id, normalized);
    }

    for (const approval of parsed.approvals ?? []) {
      const normalized = normalizeApproval(approval);
      this.approvals.set(normalized.id, normalized);
    }

    for (const event of parsed.auditEvents ?? []) {
      const normalized = normalizeAuditEvent(event);
      this.auditEvents.set(normalized.id, normalized);
    }

    for (const job of parsed.queueJobs ?? []) {
      const normalized = normalizeQueueJob(job);
      this.queueJobs.set(normalized.id, normalized);
    }

    for (const notification of parsed.slackNotifications ?? []) {
      const normalized = normalizeSlackNotification(notification);
      this.slackNotifications.set(normalized.id, normalized);
    }
  }

  private isEmpty(): boolean {
    return (
      this.sessions.size === 0 &&
      this.taskRuns.size === 0 &&
      this.approvals.size === 0 &&
      this.auditEvents.size === 0 &&
      this.queueJobs.size === 0 &&
      this.slackNotifications.size === 0
    );
  }

  private canClaimQueueJob(job: QueueJob, input: QueueClaimInput): boolean {
    const sessionLeaseCount = (
      this.db
        .prepare("SELECT COUNT(*) AS count FROM queue_jobs WHERE status = 'leased' AND session_id = ?")
        .get(job.sessionId) as { count: number }
    ).count;
    const repoLeaseCount = (
      this.db
        .prepare("SELECT COUNT(*) AS count FROM queue_jobs WHERE status = 'leased' AND repo_id = ?")
        .get(job.repoId) as { count: number }
    ).count;

    return sessionLeaseCount < input.sessionConcurrencyLimit && repoLeaseCount < input.repoConcurrencyLimit;
  }

  private upsert(
    table: "sessions" | "task_runs" | "approvals" | "audit_events" | "queue_jobs" | "slack_notifications",
    id: string,
    value: unknown
  ): void {
    if (table === "sessions") {
      const session = value as Session;
      this.db
        .prepare(
          "INSERT OR REPLACE INTO sessions (id, slack_thread_key, owner_slack_user_id, status, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(session.id, session.slackThreadKey, session.ownerSlackUserId, session.status, session.updatedAt, JSON.stringify(session));
      return;
    }

    if (table === "task_runs") {
      const run = value as TaskRun;
      this.db
        .prepare("INSERT OR REPLACE INTO task_runs (id, session_id, status, completed_at, data) VALUES (?, ?, ?, ?, ?)")
        .run(run.id, run.sessionId, run.status, run.completedAt ?? null, JSON.stringify(run));
      return;
    }

    if (table === "audit_events") {
      const event = value as AuditEvent;
      this.db
        .prepare(
          "INSERT OR REPLACE INTO audit_events (id, at, type, outcome, actor_slack_user_id, session_id, repo_id, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          event.id,
          event.at,
          event.type,
          event.outcome,
          event.actorSlackUserId ?? null,
          event.sessionId ?? null,
          event.repoId ?? null,
          JSON.stringify(event)
        );
      return;
    }

    if (table === "queue_jobs") {
      const job = value as QueueJob;
      this.db
        .prepare(
          "INSERT OR REPLACE INTO queue_jobs (id, kind, status, session_id, repo_id, task_run_id, created_at, available_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          job.id,
          job.kind,
          job.status,
          job.sessionId,
          job.repoId,
          job.taskRunId ?? null,
          job.createdAt,
          job.availableAt,
          job.updatedAt,
          JSON.stringify(job)
        );
      return;
    }

    if (table === "slack_notifications") {
      const notification = value as SlackNotification;
      this.db
        .prepare(
          "INSERT OR REPLACE INTO slack_notifications (id, kind, status, slack_thread_key, session_id, repo_id, task_run_id, queue_job_id, available_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          notification.id,
          notification.kind,
          notification.status,
          notification.slackThreadKey,
          notification.sessionId,
          notification.repoId ?? null,
          notification.taskRunId ?? null,
          notification.queueJobId ?? null,
          notification.availableAt,
          notification.updatedAt,
          JSON.stringify(notification)
        );
      return;
    }

    const approval = value as ApprovalRequest;
    this.db
      .prepare(
        "INSERT OR REPLACE INTO approvals (id, session_id, task_run_id, status, expires_at, data) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(approval.id, approval.sessionId, approval.taskRunId, approval.status, approval.expiresAt, JSON.stringify(approval));
  }
}
