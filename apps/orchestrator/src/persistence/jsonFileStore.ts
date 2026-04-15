import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ApprovalRequest,
  AuditEvent,
  EmailInboundMessageRecord,
  EmailNotification,
  QueueJob,
  Session,
  SlackNotification,
  TaskRun
} from "../../../../packages/shared/src/types.js";
import { InMemoryStore } from "./inMemory.js";
import {
  normalizeAuditEvent,
  normalizeApproval,
  normalizeEmailInboundMessage,
  normalizeEmailNotification,
  normalizeQueueJob,
  normalizeSession,
  normalizeSlackNotification,
  normalizeTaskRun,
  type PersistedState
} from "./stateNormalization.js";

export class JsonFileStore extends InMemoryStore {
  constructor(private readonly statePath: string) {
    super();
  }

  static load(statePath: string): JsonFileStore {
    const store = new JsonFileStore(statePath);

    if (!existsSync(statePath)) {
      store.flush();
      return store;
    }

    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedState;

    for (const session of parsed.sessions ?? []) {
      const normalized = normalizeSession(session);
      store.sessions.set(normalized.id, normalized);
      store.sessionIdsByThread.set(normalized.slackThreadKey, normalized.id);
    }

    for (const taskRun of parsed.taskRuns ?? []) {
      store.taskRuns.set(taskRun.id, normalizeTaskRun(taskRun));
    }

    for (const approval of parsed.approvals ?? []) {
      store.approvals.set(approval.id, normalizeApproval(approval));
    }

    for (const event of parsed.auditEvents ?? []) {
      store.auditEvents.set(event.id, normalizeAuditEvent(event));
    }

    for (const job of parsed.queueJobs ?? []) {
      store.queueJobs.set(job.id, normalizeQueueJob(job));
    }

    for (const notification of parsed.slackNotifications ?? []) {
      store.slackNotifications.set(notification.id, normalizeSlackNotification(notification));
    }

    for (const notification of parsed.emailNotifications ?? []) {
      store.emailNotifications.set(notification.id, normalizeEmailNotification(notification));
    }

    for (const record of parsed.emailInboundMessages ?? []) {
      const normalized = normalizeEmailInboundMessage(record);
      store.emailInboundMessages.set(normalized.id, normalized);
    }

    store.flush();
    return store;
  }

  override saveSession(session: Session): void {
    super.saveSession(session);
    this.flush();
  }

  override saveTaskRun(run: TaskRun): void {
    super.saveTaskRun(run);
    this.flush();
  }

  override saveApproval(approval: ApprovalRequest): void {
    super.saveApproval(approval);
    this.flush();
  }

  override saveAuditEvent(event: AuditEvent): void {
    super.saveAuditEvent(event);
    this.flush();
  }

  override saveQueueJob(job: QueueJob): void {
    super.saveQueueJob(job);
    this.flush();
  }

  override saveSlackNotification(notification: SlackNotification): void {
    super.saveSlackNotification(notification);
    this.flush();
  }

  override saveEmailNotification(notification: EmailNotification): void {
    super.saveEmailNotification(notification);
    this.flush();
  }

  override saveEmailInboundMessage(record: EmailInboundMessageRecord): void {
    super.saveEmailInboundMessage(record);
    this.flush();
  }

  flush(): void {
    mkdirSync(dirname(this.statePath), { recursive: true });

    const state: PersistedState = {
      version: 5,
      sessions: [...this.sessions.values()],
      taskRuns: [...this.taskRuns.values()],
      approvals: [...this.approvals.values()],
      auditEvents: [...this.auditEvents.values()].sort((a, b) => a.at.localeCompare(b.at)),
      queueJobs: [...this.queueJobs.values()],
      slackNotifications: [...this.slackNotifications.values()],
      emailNotifications: [...this.emailNotifications.values()],
      emailInboundMessages: [...this.emailInboundMessages.values()]
    };

    const tmpPath = `${this.statePath}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(tmpPath, this.statePath);
  }
}
