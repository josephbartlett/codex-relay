import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteStore } from "../apps/orchestrator/src/persistence/sqliteStore.js";
import type {
  ApprovalRequest,
  EmailInboundMessageRecord,
  EmailNotification,
  Session,
  SlackNotification,
  TaskRun
} from "../packages/shared/src/types.js";

test("sqlite store migrates JSON state and normalizes interrupted runs", () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-sqlite-"));

  try {
    const jsonPath = join(temp, "state.json");
    const databasePath = join(temp, "state.db");
    const state = {
      version: 1,
      sessions: [sampleSession({ status: "running" })],
      taskRuns: [sampleTaskRun({ status: "running" })],
      approvals: [sampleApproval({ status: "pending", expiresAt: "2000-01-01T00:00:00.000Z" })],
      auditEvents: [
        {
          id: "audit-1",
          at: "2026-04-13T00:00:00.000Z",
          type: "task.plan_started",
          outcome: "info",
          summary: "Plan started.",
          actorSlackUserId: "U1",
          slackThreadKey: "T1:C1:1000.1",
          repoId: "default",
          sessionId: "session-1",
          metadata: {}
        }
      ],
      slackNotifications: [sampleSlackNotification()],
      emailNotifications: [sampleEmailNotification()],
      emailInboundMessages: [sampleEmailInboundMessage()]
    };
    writeFileSync(jsonPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const migrated = SqliteStore.load({ databasePath, migrateFromJsonPath: jsonPath });
    assert.equal(migrated.listSessions().length, 1);
    assert.equal(migrated.getSessionByThread("T1:C1:1000.1")?.status, "failed");
    assert.equal(migrated.taskRuns.get("run-1")?.status, "failed");
    assert.equal(migrated.approvals.get("approval-1")?.status, "expired");
    assert.equal(migrated.listAuditEvents()[0]?.id, "audit-1");
    assert.equal(migrated.getSlackNotification("notification-1")?.status, "pending");
    assert.equal(migrated.getEmailNotification("email-1")?.status, "pending");
    assert.equal(migrated.getEmailInboundMessage("inbound-1")?.status, "queued");

    const session = migrated.getSessionByThread("T1:C1:1000.1");
    assert.ok(session);
    session.draftPullRequest = {
      title: "Codex: test",
      body: "body",
      branchName: session.branchName,
      commitSha: "a".repeat(40),
      prUrl: "https://github.com/example/repo/pull/1",
      changedFiles: ["README.md"],
      createdAt: "2026-04-13T00:00:00.000Z",
      createdBySlackUserId: "U1"
    };
    migrated.saveSession(session);
    migrated.saveAuditEvent({
      id: "audit-2",
      at: "2026-04-13T01:00:00.000Z",
      type: "pr.created",
      outcome: "success",
      summary: "Draft PR created.",
      actorSlackUserId: "U1",
      repoId: "default",
      sessionId: session.id,
      metadata: { prUrl: "https://github.com/example/repo/pull/1" }
    });
    migrated.close();

    const reloaded = SqliteStore.load({ databasePath, migrateFromJsonPath: jsonPath });
    assert.equal(reloaded.listSessions().length, 1);
    assert.equal(
      reloaded.getSessionByThread("T1:C1:1000.1")?.draftPullRequest?.prUrl,
      "https://github.com/example/repo/pull/1"
    );
    assert.deepEqual(
      reloaded.listAuditEvents(2).map((event) => event.id),
      ["audit-2", "audit-1"]
    );
    assert.equal(reloaded.getSlackNotification("notification-1")?.slackThreadKey, "T1:C1:1000.1");
    assert.equal(reloaded.getEmailNotification("email-1")?.to[0], "operator@example.test");
    assert.equal(reloaded.getEmailInboundMessage("inbound-1")?.messageId, "<message-1@example.test>");
    reloaded.close();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

function sampleSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    controlPlane: "slack",
    slackThreadKey: "T1:C1:1000.1",
    ownerSlackUserId: "U1",
    repoId: "default",
    sourceRepoPath: "/tmp/source",
    workspacePath: "/tmp/worktree",
    workspaceKind: "worktree",
    branchName: "codex/slack/test",
    runnerKind: "exec",
    status: "idle",
    createdAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
    ...overrides
  };
}

function sampleEmailInboundMessage(overrides: Partial<EmailInboundMessageRecord> = {}): EmailInboundMessageRecord {
  return {
    id: "inbound-1",
    mailboxId: "default",
    messageId: "<message-1@example.test>",
    threadId: "<thread-1@example.test>",
    from: "operator@example.test",
    subject: "repo:default inspect this",
    status: "queued",
    commandKind: "start_plan",
    sessionId: "session-1",
    taskRunId: "run-1",
    queueJobId: "job-1",
    receivedAt: "2026-04-13T00:00:00.000Z",
    processedAt: "2026-04-13T00:00:01.000Z",
    createdAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:01.000Z",
    metadata: {},
    ...overrides
  };
}

function sampleEmailNotification(overrides: Partial<EmailNotification> = {}): EmailNotification {
  return {
    id: "email-1",
    kind: "runner.completed",
    status: "pending",
    severity: "success",
    to: ["operator@example.test"],
    subject: "Codex Relay completed",
    text: "Summary: done",
    sessionId: "session-1",
    repoId: "default",
    taskRunId: "run-1",
    queueJobId: "job-1",
    attempts: 0,
    maxAttempts: 3,
    createdAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
    availableAt: "2026-04-13T00:00:00.000Z",
    metadata: {},
    ...overrides
  };
}

function sampleSlackNotification(overrides: Partial<SlackNotification> = {}): SlackNotification {
  return {
    id: "notification-1",
    kind: "runner.started",
    status: "pending",
    severity: "info",
    slackThreadKey: "T1:C1:1000.1",
    sessionId: "session-1",
    repoId: "default",
    taskRunId: "run-1",
    queueJobId: "job-1",
    title: "Queued task running",
    detail: "Mode: implement",
    attempts: 0,
    maxAttempts: 3,
    createdAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
    availableAt: "2026-04-13T00:00:00.000Z",
    metadata: {},
    ...overrides
  };
}

function sampleTaskRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "run-1",
    sessionId: "session-1",
    mode: "plan",
    prompt: "test",
    status: "queued",
    sandbox: "read-only",
    approvalPolicy: "never",
    ...overrides
  };
}

function sampleApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "approval-1",
    taskRunId: "run-1",
    sessionId: "session-1",
    requestedBySlackUserId: "U1",
    type: "execute_plan",
    summary: "test",
    expiresAt: "2026-04-14T00:00:00.000Z",
    status: "pending",
    createdAt: "2026-04-13T00:00:00.000Z",
    ...overrides
  };
}
