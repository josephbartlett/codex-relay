import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runRunnerDaemonOnce } from "../apps/local-runner/src/daemon.js";
import { InMemoryStore } from "../apps/orchestrator/src/persistence/inMemory.js";
import { DurableQueue } from "../apps/orchestrator/src/queue.js";
import { Orchestrator } from "../apps/orchestrator/src/tasks.js";
import type { HarnessConfig } from "../packages/shared/src/config.js";
import type {
  RunHandle,
  RunnerAdapter,
  RunnerEventSink,
  RunnerResult,
  RunnerTaskSpec,
  Session
} from "../packages/shared/src/types.js";

const baseNow = new Date("2026-04-13T00:00:00.000Z");

class FakeRunner implements RunnerAdapter {
  readonly tasks: RunnerTaskSpec[] = [];

  constructor(private readonly results: RunnerResult[]) {}

  start(task: RunnerTaskSpec, sink?: RunnerEventSink): RunHandle {
    void sink;
    this.tasks.push(task);
    const result =
      this.results.shift() ??
      ({
        runId: task.runId,
        status: "completed",
        finalMessage: "done",
        stdout: "",
        stderr: "",
        exitCode: 0
      } satisfies RunnerResult);

    return {
      runId: task.runId,
      promise: Promise.resolve({ ...result, runId: task.runId }),
      cancel: async () => undefined
    };
  }

  resume(): RunHandle {
    throw new Error("not used");
  }

  async cancel(): Promise<void> {
    return undefined;
  }
}

test("orchestrator can enqueue a session task and daemon completes it", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-daemon-"));

  try {
    const store = new InMemoryStore();
    const runner = new FakeRunner([
      {
        runId: "placeholder",
        status: "completed",
        finalMessage: "implemented from queue",
        stdout: "",
        stderr: "",
        codexSessionId: "codex-session-1",
        exitCode: 0
      }
    ]);
    const config = makeConfig(temp);
    const orchestrator = new Orchestrator(config, store, runner);
    store.saveSession(sampleSession({ workspacePath: temp, sourceRepoPath: temp }));

    const enqueued = orchestrator.enqueueRunnerTaskForSession({
      sessionId: "session-1",
      requestingUserId: "U1",
      slackChannelId: "C1",
      mode: "implement",
      prompt: "make the change",
      sandbox: "workspace-write",
      approvalPolicy: "never",
      now: baseNow
    });

    assert.equal(enqueued.taskRun.status, "queued");
    assert.equal(enqueued.job.status, "queued");
    assert.equal(runner.tasks.length, 0);

    const result = await runRunnerDaemonOnce({
      store,
      runner,
      runnerId: "worker-1",
      heartbeatIntervalMs: 0,
      now: () => baseNow
    });

    assert.equal(result.claimed, true);
    assert.equal(result.finalJob?.status, "completed");
    assert.equal(store.taskRuns.get(enqueued.taskRun.id)?.status, "completed");
    assert.equal(store.sessions.get("session-1")?.status, "done");
    assert.equal(store.sessions.get("session-1")?.codexSessionId, "codex-session-1");
    assert.deepEqual(
      new Set(store.listAuditEvents(3).map((event) => event.type)),
      new Set(["queue.completed", "queue.claimed", "queue.enqueued"])
    );
    assert.deepEqual(
      store.listSlackNotifications().map((notification) => notification.kind),
      ["runner.started", "runner.completed"]
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("daemon requeues failed attempts and fails after max attempts", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-daemon-retry-"));

  try {
    const store = new InMemoryStore();
    const queue = new DurableQueue(store);
    const runner = new FakeRunner([
      {
        runId: "placeholder",
        status: "failed",
        finalMessage: "first failure",
        stdout: "",
        stderr: "first failure",
        exitCode: 1
      },
      {
        runId: "placeholder",
        status: "failed",
        finalMessage: "second failure",
        stdout: "",
        stderr: "second failure",
        exitCode: 1
      }
    ]);
    const orchestrator = new Orchestrator(makeConfig(temp), store, runner);
    store.saveSession(sampleSession({ workspacePath: temp, sourceRepoPath: temp }));
    const enqueued = orchestrator.enqueueRunnerTaskForSession({
      sessionId: "session-1",
      requestingUserId: "U1",
      slackChannelId: "C1",
      mode: "implement",
      prompt: "try",
      sandbox: "workspace-write",
      approvalPolicy: "never",
      maxAttempts: 2,
      now: baseNow
    });

    const first = await runRunnerDaemonOnce({
      store,
      queue,
      runner,
      runnerId: "worker-1",
      heartbeatIntervalMs: 0,
      now: () => baseNow
    });
    assert.equal(first.finalJob?.status, "queued");
    assert.equal(first.finalJob?.attempts, 1);
    assert.equal(store.taskRuns.get(enqueued.taskRun.id)?.status, "queued");
    assert.equal(store.sessions.get("session-1")?.status, "running");

    const second = await runRunnerDaemonOnce({
      store,
      queue,
      runner,
      runnerId: "worker-1",
      heartbeatIntervalMs: 0,
      now: () => baseNow
    });

    assert.equal(second.finalJob?.status, "failed");
    assert.equal(second.finalJob?.attempts, 2);
    assert.equal(store.getQueueJob(enqueued.job.id)?.status, "failed");
    assert.equal(store.taskRuns.get(enqueued.taskRun.id)?.status, "failed");
    assert.equal(store.sessions.get("session-1")?.status, "failed");
    assert.equal(store.listAuditEvents().filter((event) => event.type === "queue.failed").length, 2);
    assert.deepEqual(
      store.listSlackNotifications().map((notification) => notification.kind),
      ["runner.started", "runner.failed"]
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("daemon completed plan jobs create pending approvals", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-daemon-plan-"));

  try {
    const store = new InMemoryStore();
    const runner = new FakeRunner([
      {
        runId: "placeholder",
        status: "completed",
        finalMessage: "Plan: edit README",
        stdout: "",
        stderr: "",
        exitCode: 0
      }
    ]);
    const orchestrator = new Orchestrator(makeConfig(temp), store, runner);
    store.saveSession(sampleSession({ workspacePath: temp, sourceRepoPath: temp }));
    const enqueued = orchestrator.enqueueRunnerTaskForSession({
      sessionId: "session-1",
      requestingUserId: "U1",
      slackChannelId: "C1",
      mode: "plan",
      prompt: "inspect",
      sandbox: "read-only",
      approvalPolicy: "never",
      now: baseNow
    });

    const result = await runRunnerDaemonOnce({
      store,
      runner,
      runnerId: "worker-1",
      heartbeatIntervalMs: 0,
      now: () => baseNow
    });

    assert.equal(result.finalJob?.status, "completed");
    assert.equal(store.taskRuns.get(enqueued.taskRun.id)?.status, "awaiting_approval");
    assert.equal(store.sessions.get("session-1")?.status, "awaiting_approval");
    const approval = [...store.approvals.values()][0];
    assert.equal(approval?.taskRunId, enqueued.taskRun.id);
    assert.equal(approval?.status, "pending");
    assert.equal(
      store.listAuditEvents().some((event) => event.type === "approval.created" && event.taskRunId === enqueued.taskRun.id),
      true
    );
    assert.deepEqual(
      store.listSlackNotifications().map((notification) => notification.kind),
      ["runner.started", "plan.ready"]
    );
    assert.equal(store.listSlackNotifications().find((notification) => notification.kind === "plan.ready")?.approvalId, approval?.id);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("daemon does not accept runner results after lease expiry", async () => {
  const store = new InMemoryStore();
  const queue = new DurableQueue(store, { leaseTtlMs: 1_000 });
  const runner = new FakeRunner([
    {
      runId: "placeholder",
      status: "completed",
      finalMessage: "late success",
      stdout: "",
      stderr: "",
      exitCode: 0
    }
  ]);
  let index = 0;
  const times = [new Date("2026-04-13T00:00:00.000Z"), new Date("2026-04-13T00:00:02.000Z")];
  const job = queue.enqueueRunnerTask({
    repoId: "default",
    task: {
      runId: "run-1",
      sessionId: "session-1",
      mode: "implement",
      prompt: "try",
      workspacePath: "/tmp/worktree",
      sandbox: "workspace-write",
      approvalPolicy: "never"
    },
    maxAttempts: 2,
    now: baseNow
  });

  const result = await runRunnerDaemonOnce({
    store,
    queue,
    runner,
    runnerId: "worker-1",
    heartbeatIntervalMs: 0,
    now: () => times[Math.min(index++, times.length - 1)] ?? baseNow
  });

  assert.equal(result.finalJob?.status, "queued");
  assert.equal(result.finalJob?.attempts, 1);
  assert.equal(store.getQueueJob(job.id)?.status, "queued");
});

function makeConfig(root: string): HarnessConfig {
  return {
    slack: {
      botToken: "",
      appToken: "",
      signingSecret: ""
    },
    codex: {
      command: "codex",
      worktreeRoot: join(root, "worktrees"),
      statePath: join(root, "state.json"),
      runnerEnvAllowlist: ["PATH", "HOME", "NO_COLOR"],
      profilesPath: join(root, "profiles.toml"),
      rulesPath: join(root, "default.rules"),
      requireExecPolicyCheck: true,
      storeKind: "json",
      databasePath: join(root, "state.db")
    },
    repos: [{ id: "default", path: root }],
    defaultRepoId: "default",
    policy: {
      mode: "local-dev",
      allowedSlackUserIds: [],
      maintainerSlackUserIds: [],
      allowedSlackChannelIds: [],
      repoPolicies: {}
    }
  };
}

function sampleSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    slackThreadKey: "T1:C1:1000.1",
    ownerSlackUserId: "U1",
    repoId: "default",
    sourceRepoPath: "/tmp/source",
    workspacePath: "/tmp/worktree",
    branchName: "codex/slack/test",
    runnerKind: "exec",
    status: "idle",
    createdAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
    ...overrides
  };
}
