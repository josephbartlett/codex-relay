import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runRunnerDaemonOnce } from "../apps/local-runner/src/daemon.js";
import { parseLocalSessionArgs } from "../apps/local-runner/src/localSession.js";
import { runGit } from "../apps/local-runner/src/git.js";
import { buildSlackTaskContext } from "../apps/orchestrator/src/context.js";
import { InMemoryStore } from "../apps/orchestrator/src/persistence/inMemory.js";
import { Orchestrator } from "../apps/orchestrator/src/tasks.js";
import type { HarnessConfig } from "../packages/shared/src/config.js";
import type {
  RunHandle,
  RunnerAdapter,
  RunnerEventSink,
  RunnerResult,
  RunnerTaskSpec
} from "../packages/shared/src/types.js";

const baseNow = new Date("2026-04-14T00:00:00.000Z");

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

test("parseLocalSessionArgs supports thread-key and trailing prompt text", () => {
  const parsed = parseLocalSessionArgs([
    "--thread-key",
    "T1:C1:1000.1",
    "--user",
    "U1",
    "--repo",
    "default",
    "--mode",
    "implement",
    "--",
    "make",
    "the",
    "change"
  ]);

  assert.deepEqual(parsed, {
    teamId: "T1",
    channelId: "C1",
    threadTs: "1000.1",
    userId: "U1",
    repoId: "default",
    mode: "implement",
    prompt: "make the change"
  });
});

test("local handoff enqueues an isolated implementation and posts queued summary state", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-local-handoff-"));

  try {
    const repo = join(temp, "repo");
    await initRepo(repo);
    const config = makeConfig(temp, repo);
    const store = new InMemoryStore();
    const runner = new FakeRunner([
      {
        runId: "placeholder",
        status: "completed",
        finalMessage: "Implemented local handoff change.\nTests: not run.",
        stdout: "",
        stderr: "",
        codexSessionId: "codex-session-local-1",
        exitCode: 0
      }
    ]);
    const orchestrator = new Orchestrator(config, store, runner);
    const slack = buildSlackTaskContext({
      teamId: "T1",
      channelId: "C1",
      threadTs: "1000.1",
      requestingUserId: "U1",
      text: "repo:default implement from local handoff"
    });

    const enqueued = await orchestrator.enqueueLocalHandoffFromSlack({
      slack,
      repoId: "default",
      mode: "implement",
      now: baseNow
    });

    assert.equal(enqueued.taskRun.mode, "implement");
    assert.equal(enqueued.taskRun.sandbox, "workspace-write");
    assert.equal(enqueued.taskRun.status, "queued");
    assert.equal(enqueued.job.status, "queued");
    assert.equal(enqueued.session.status, "idle");
    assert.equal(enqueued.session.slackThreadKey, "T1:C1:1000.1");
    assert.notEqual(enqueued.session.workspacePath, repo);
    assert.match(enqueued.session.workspacePath, /worktrees/);
    assert.equal(runner.tasks.length, 0);

    const result = await runRunnerDaemonOnce({
      store,
      runner,
      runnerId: "worker-1",
      heartbeatIntervalMs: 0,
      now: () => baseNow
    });

    assert.equal(result.finalJob?.status, "completed");
    assert.equal(store.taskRuns.get(enqueued.taskRun.id)?.status, "completed");
    assert.equal(store.sessions.get(enqueued.session.id)?.status, "done");
    assert.equal(store.sessions.get(enqueued.session.id)?.codexSessionId, "codex-session-local-1");
    assert.deepEqual(
      store.listSlackNotifications().map((notification) => notification.kind),
      ["runner.started", "runner.completed"]
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("Slack follow-up continues a completed local handoff session with saved Codex id", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-local-continue-"));

  try {
    const repo = join(temp, "repo");
    await initRepo(repo);
    const config = makeConfig(temp, repo);
    const store = new InMemoryStore();
    const runner = new FakeRunner([
      {
        runId: "placeholder",
        status: "completed",
        finalMessage: "Local implementation completed.",
        stdout: "",
        stderr: "",
        codexSessionId: "codex-session-local-1",
        exitCode: 0
      },
      {
        runId: "placeholder",
        status: "completed",
        finalMessage: "Summary\nContinue with a small follow-up plan.",
        stdout: "",
        stderr: "",
        codexSessionId: "codex-session-local-2",
        exitCode: 0
      }
    ]);
    const orchestrator = new Orchestrator(config, store, runner);
    const slack = buildSlackTaskContext({
      teamId: "T1",
      channelId: "C1",
      threadTs: "1000.1",
      requestingUserId: "U1",
      text: "repo:default implement from local handoff"
    });
    const enqueued = await orchestrator.enqueueLocalHandoffFromSlack({
      slack,
      repoId: "default",
      mode: "implement",
      now: baseNow
    });

    await runRunnerDaemonOnce({
      store,
      runner,
      runnerId: "worker-1",
      heartbeatIntervalMs: 0,
      now: () => baseNow
    });

    const followUp = await orchestrator.handleFollowUpFromSlack(
      buildSlackTaskContext({
        teamId: "T1",
        channelId: "C1",
        threadTs: "1000.1",
        requestingUserId: "U1",
        text: "continue and add a short test plan"
      })
    );

    assert.equal(followUp.kind, "plan");
    assert.equal(runner.tasks.length, 2);
    assert.equal(runner.tasks[1]?.codexSessionId, "codex-session-local-1");
    assert.equal(runner.tasks[1]?.workspacePath, enqueued.session.workspacePath);
    assert.equal(store.sessions.get(enqueued.session.id)?.codexSessionId, "codex-session-local-2");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

async function initRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true });
  await runGit(["init"], repoPath);
  await runGit(["config", "user.email", "codex-relay@example.test"], repoPath);
  await runGit(["config", "user.name", "Codex Relay Test"], repoPath);
  writeFileSync(join(repoPath, "README.md"), "# test\n", "utf8");
  await runGit(["add", "README.md"], repoPath);
  await runGit(["commit", "-m", "initial"], repoPath);
}

function makeConfig(root: string, repoPath: string): HarnessConfig {
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
    repos: [{ id: "default", path: repoPath }],
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
