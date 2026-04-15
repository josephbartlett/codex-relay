import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runGit } from "../apps/local-runner/src/git.js";
import { DIFF_ARTIFACT_RETENTION, collectDiffSummary } from "../apps/orchestrator/src/artifacts.js";
import { InMemoryStore } from "../apps/orchestrator/src/persistence/inMemory.js";
import { DurableQueue } from "../apps/orchestrator/src/queue.js";
import { Orchestrator } from "../apps/orchestrator/src/tasks.js";
import { completionBlocks, diffSummaryBlocks, prLifecycleBlocks, prStatusBlocks } from "../apps/slack-gateway/src/blocks/taskCards.js";
import type { HarnessConfig, HarnessPolicyConfig } from "../packages/shared/src/config.js";
import type { Session } from "../packages/shared/src/types.js";
import type {
  RunHandle,
  RunnerAdapter,
  RunnerEventSink,
  RunnerResult,
  RunnerTaskSpec
} from "../packages/shared/src/types.js";

class FakeRunner implements RunnerAdapter {
  readonly cancelled = new Set<string>();
  readonly tasks: RunnerTaskSpec[] = [];
  onStart?: (task: RunnerTaskSpec) => void;

  start(task: RunnerTaskSpec, sink?: RunnerEventSink): RunHandle {
    this.tasks.push(task);
    this.onStart?.(task);
    const promise = this.runTask(task, sink);
    return {
      runId: task.runId,
      promise,
      cancel: async () => {
        this.cancelled.add(task.runId);
      }
    };
  }

  resume(): RunHandle {
    throw new Error("not used");
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.add(runId);
  }

  private async runTask(task: RunnerTaskSpec, sink?: RunnerEventSink): Promise<RunnerResult> {
    await sink?.({ runId: task.runId, type: "fake", message: task.mode, at: new Date().toISOString() });

    if (task.mode === "implement") {
      const outputPath = join(task.workspacePath, "src", "codex-output.txt");
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, "implemented\n", "utf8");
      writeFileSync(join(task.workspacePath, ".codex"), "", "utf8");
    }

    return {
      runId: task.runId,
      status: "completed",
      finalMessage:
        task.mode === "plan"
          ? "Summary: create codex-output.txt"
          : task.mode === "explain"
            ? "Answer: package.json defines the scripts."
          : task.mode === "test"
            ? "Summary: tests passed"
            : "Summary: wrote codex-output.txt",
      stdout: "",
      stderr: "",
      codexSessionId: `codex-${task.sessionId}`,
      exitCode: 0
    };
  }
}

test("plan approval execute flow writes in a worktree and reports untracked files", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-flow-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const prLifecycleInputs: Array<{ existing: boolean }> = [];
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner, async (input) => {
      prLifecycleInputs.push({ existing: Boolean(input.existingPullRequest) });
      if (input.existingPullRequest) {
        return input.existingPullRequest;
      }

      assert.equal(input.branchName.startsWith("codex/slack/"), true);
      assert.equal(input.title, "Codex: wrote codex-output.txt");
      assert.match(input.body, /src\/codex-output\.txt/);
      return {
        title: input.title,
        body: input.body,
        branchName: input.branchName,
        commitSha: "a".repeat(40),
        prUrl: "https://github.com/example/repo/pull/7",
        changedFiles: ["src/codex-output.txt"]
      };
    });

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.1" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });

    assert.equal(plan.approval.status, "pending");
    assert.equal(orchestrator.listSessions()[0]?.status, "awaiting_approval");
    assert.equal(
      orchestrator.listAuditEventsForSlackUser("U1").some((event) => event.type === "approval.created"),
      true
    );

    const executed = await orchestrator.approveAndExecute(plan.approval.id, "U1");
    assert.equal(executed.runnerResult.status, "completed");
    assert.deepEqual(executed.diff.changedFiles, ["src/codex-output.txt"]);
    assert.equal(orchestrator.listSessions()[0]?.status, "done");
    assert.equal(
      orchestrator.listAuditEventsForSlackUser("U1").some((event) => event.type === "execution.completed"),
      true
    );

    const sessionId = orchestrator.listSessions()[0]?.id ?? "";
    const pr = await orchestrator.createDraftPullRequest({ sessionId, requestingUserId: "U1", slackChannelId: "C1" });
    assert.equal(pr.operation, "created");
    assert.equal(pr.result.prUrl, "https://github.com/example/repo/pull/7");
    assert.equal(orchestrator.getSession(sessionId)?.draftPullRequest?.prUrl, pr.result.prUrl);
    assert.equal(
      orchestrator.listAuditEventsForSlackUser("U1").some((event) => event.type === "pr.created"),
      true
    );

    const duplicatePr = await orchestrator.createDraftPullRequest({ sessionId, requestingUserId: "U1", slackChannelId: "C1" });
    assert.equal(duplicatePr.operation, "unchanged");
    assert.equal(duplicatePr.result.prUrl, pr.result.prUrl);
    assert.deepEqual(prLifecycleInputs, [{ existing: false }, { existing: true }]);

    const cleanup = await orchestrator.cleanupWorktrees({
      requestingUserId: "U1",
      slackChannelId: "C1",
      olderThanDays: 0,
      dryRun: true
    });
    assert.equal(cleanup.inspected, 1);
    assert.equal(cleanup.policy.completedSessionRequiresDraftPullRequest, true);
    assert.equal(cleanup.policy.removesDirtyWorktrees, false);
    assert.equal(cleanup.skipped[0]?.reason, "dry run");

    await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.1" },
      requestingUserId: "U1",
      text: "repo:default inspect the existing changes"
    });
    assert.equal(runner.tasks.at(-1)?.codexSessionId, `codex-${orchestrator.listSessions()[0]?.id}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("ask mode answers from the source repo without approval or PR controls", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-ask-mode-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    const result = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "2000.1" },
      requestingUserId: "U1",
      text: "repo:default ask which file defines the npm scripts?"
    });

    assert.equal(result.kind, "ask");
    if (result.kind !== "ask") {
      throw new Error("Expected ask result.");
    }

    assert.equal(result.session.workspaceKind, "source");
    assert.equal(result.session.workspacePath, sourceRepo);
    assert.equal(result.askRun.mode, "explain");
    assert.equal(result.askRun.status, "completed");
    assert.equal(store.approvals.size, 0);
    assert.equal(runner.tasks[0]?.sandbox, "read-only");
    assert.match(runner.tasks[0]?.prompt ?? "", /ask mode/u);
    assert.equal(
      orchestrator.listAuditEventsForSlackUser("U1").some((event) => event.type === "task.ask_completed"),
      true
    );

    await assert.rejects(
      () => orchestrator.createDraftPullRequest({ sessionId: result.session.id, requestingUserId: "U1", slackChannelId: "C1" }),
      /source workspace/u
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("ask mode preserves an existing worktree session workspace", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-ask-existing-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "2000.15" },
      requestingUserId: "U1",
      text: "repo:default plan a small README update"
    });
    const originalWorkspacePath = orchestrator.listSessions()[0]?.workspacePath;
    assert.ok(originalWorkspacePath);

    const result = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "2000.15" },
      requestingUserId: "U1",
      text: "ask which file would change?"
    });

    assert.equal(result.kind, "ask");
    if (result.kind !== "ask") {
      throw new Error("Expected ask result.");
    }

    assert.equal(result.session.workspaceKind, "worktree");
    assert.equal(result.session.workspacePath, originalWorkspacePath);
    assert.equal(result.askRun.mode, "explain");
    assert.equal(store.approvals.size, 1);
    assert.equal(runner.tasks.at(-1)?.workspacePath, originalWorkspacePath);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("direct workspace mode is opt-in and writes the source repo without PR handoff", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-direct-mode-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const disabled = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    await assert.rejects(
      () =>
        disabled.handleFollowUpFromSlack({
          thread: { teamId: "T1", channelId: "C1", threadTs: "3000.1" },
          requestingUserId: "U1",
          text: "repo:default quick add a generated output file"
        }),
      /Direct workspace mode is disabled/u
    );

    const config = makeConfig(temp, sourceRepo);
    config.codex.directWorkspace = {
      enabled: true,
      allowedRepoIds: ["default"],
      requireClean: true
    };
    const enabled = new Orchestrator(config, new InMemoryStore(), runner);
    const result = await enabled.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "3000.2" },
      requestingUserId: "U1",
      text: "repo:default quick add a generated output file"
    });

    assert.equal(result.kind, "direct");
    if (result.kind !== "direct") {
      throw new Error("Expected direct result.");
    }

    assert.equal(result.session.workspaceKind, "source");
    assert.equal(result.session.workspacePath, sourceRepo);
    assert.equal(result.directRun.mode, "implement");
    assert.equal(result.directRun.sandbox, "workspace-write");
    assert.deepEqual(result.diff.changedFiles, ["src/codex-output.txt"]);
    assert.equal(existsSync(join(sourceRepo, "src", "codex-output.txt")), true);
    await assert.rejects(
      () => enabled.createDraftPullRequest({ sessionId: result.session.id, requestingUserId: "U1", slackChannelId: "C1" }),
      /source workspace/u
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("cleanup policy skips active queued pending and PR-incomplete sessions", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-cleanup-policy-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);
    const old = "2026-01-01T00:00:00.000Z";

    store.saveSession(sampleSession({ id: "active", workspacePath: join(temp, "active"), sourceRepoPath: sourceRepo, updatedAt: old }));
    store.saveTaskRun({
      id: "run-active",
      sessionId: "active",
      mode: "implement",
      prompt: "active",
      status: "running",
      sandbox: "workspace-write",
      approvalPolicy: "never"
    });
    store.activeRuns.set("run-active", {
      runId: "run-active",
      promise: new Promise(() => undefined),
      cancel: async () => undefined
    });

    store.saveSession(sampleSession({ id: "queued", status: "failed", workspacePath: join(temp, "queued"), sourceRepoPath: sourceRepo, updatedAt: old }));
    new DurableQueue(store).enqueueRunnerTask({
      repoId: "default",
      task: {
        runId: "run-queued",
        sessionId: "queued",
        mode: "implement",
        prompt: "queued",
        workspacePath: join(temp, "queued"),
        sandbox: "workspace-write",
        approvalPolicy: "never"
      },
      now: new Date(old)
    });

    store.saveSession(sampleSession({ id: "pending", status: "failed", workspacePath: join(temp, "pending"), sourceRepoPath: sourceRepo, updatedAt: old }));
    store.saveApproval({
      id: "approval-pending",
      taskRunId: "run-pending",
      sessionId: "pending",
      requestedBySlackUserId: "U1",
      type: "execute_plan",
      summary: "pending",
      expiresAt: "2027-01-01T00:00:00.000Z",
      status: "pending",
      createdAt: old
    });

    store.saveSession(sampleSession({ id: "no-pr", workspacePath: join(temp, "no-pr"), sourceRepoPath: sourceRepo, updatedAt: old }));

    const cleanup = await orchestrator.cleanupWorktrees({
      requestingUserId: "U1",
      slackChannelId: "C1",
      olderThanDays: 1,
      dryRun: false
    });

    assert.equal(cleanup.inspected, 4);
    assert.equal(cleanup.removed.length, 0);
    assert.deepEqual(
      cleanup.skipped.map((item) => item.reason).sort(),
      [
        "completed session has no draft PR metadata",
        "session still has a pending approval",
        "session still has an active run",
        "session still has queued runner work"
      ].sort()
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("cleanup removes clean eligible worktrees and skips dirty worktrees", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-cleanup-remove-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const cleanWorktree = join(temp, "clean-worktree");
    const dirtyWorktree = join(temp, "dirty-worktree");
    await runGit(["worktree", "add", "-b", "codex/slack/clean", cleanWorktree, "HEAD"], sourceRepo);
    await runGit(["worktree", "add", "-b", "codex/slack/dirty", dirtyWorktree, "HEAD"], sourceRepo);
    writeFileSync(join(dirtyWorktree, "dirty.txt"), "dirty\n", "utf8");

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);
    const old = "2026-01-01T00:00:00.000Z";
    store.saveSession(sampleSession({ id: "clean", status: "failed", workspacePath: cleanWorktree, sourceRepoPath: sourceRepo, updatedAt: old }));
    store.saveSession(sampleSession({ id: "dirty", status: "failed", workspacePath: dirtyWorktree, sourceRepoPath: sourceRepo, updatedAt: old }));

    const cleanup = await orchestrator.cleanupWorktrees({
      requestingUserId: "U1",
      slackChannelId: "C1",
      olderThanDays: 1,
      dryRun: false
    });

    assert.deepEqual(cleanup.removed.map((item) => item.sessionId), ["clean"]);
    assert.equal(orchestrator.getSession("clean")?.cleanedAt !== undefined, true);
    assert.equal(existsSync(cleanWorktree), false);
    assert.equal(existsSync(dirtyWorktree), true);
    assert.equal(cleanup.skipped[0]?.sessionId, "dirty");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("diff artifacts are bounded and marked ephemeral", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-diff-retention-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    writeFileSync(join(repo, "README.md"), `${"changed\n".repeat(10_000)}`, "utf8");

    const diff = await collectDiffSummary(repo);

    assert.equal(diff.retention?.storage, "ephemeral");
    assert.equal(diff.retention?.persisted, false);
    assert.equal(diff.retention?.limits.patchPreviewMaxChars, DIFF_ARTIFACT_RETENTION.patchPreviewMaxChars);
    assert.equal((diff.patchPreview?.length ?? 0) <= DIFF_ARTIFACT_RETENTION.patchPreviewMaxChars, true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("existing draft PRs can be updated and checked without starting Codex runner tasks", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-lifecycle-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const prInputs: Array<{ existing: boolean }> = [];
    let readyCalls = 0;
    const orchestrator = new Orchestrator(
      makeConfig(temp, sourceRepo),
      store,
      runner,
      async (input) => {
        prInputs.push({ existing: Boolean(input.existingPullRequest) });

        if (input.existingPullRequest) {
          return {
            ...input.existingPullRequest,
            title: input.title,
            body: input.body,
            commitSha: "b".repeat(40),
            changedFiles: ["src/codex-output.txt"]
          };
        }

        return {
          title: input.title,
          body: input.body,
          branchName: input.branchName,
          commitSha: "a".repeat(40),
          prUrl: "https://github.com/example/repo/pull/8",
          changedFiles: ["src/codex-output.txt"]
        };
      },
      async (input) => ({
        prUrl: input.prUrl,
        state: "OPEN",
        isDraft: true,
        mergeable: "MERGEABLE",
        headRefName: "codex/slack/test",
        checksSummary: "All 2 status check(s) passed.",
        checksTotal: 2,
        checksPassed: 2,
        checksFailed: 0,
        checksPending: 0,
        checkDetails: [
          {
            name: "private-ci-job-name",
            state: "passed",
            conclusion: "SUCCESS",
            url: "https://github.com/example/repo/actions/runs/1"
          }
        ],
        checkedAt: new Date().toISOString()
      }),
      async (input) => ({
        prUrl: input.prUrl,
        state: "OPEN",
        isDraft: false,
        headRefName: input.branchName,
        checksSummary: "All 2 status check(s) passed.",
        checksTotal: 2,
        checksPassed: 2,
        checksFailed: 0,
        checksPending: 0,
        checkDetails: [
          {
            name: "private-ready-ci-job",
            state: "passed",
            conclusion: "SUCCESS",
            url: "https://github.com/example/repo/actions/runs/2"
          }
        ],
        checkedAt: new Date().toISOString(),
        operation: readyCalls++ === 0 ? "ready" : "already_ready"
      })
    );

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.11" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });
    await orchestrator.approveAndExecute(plan.approval.id, "U1");

    const sessionId = orchestrator.listSessions()[0]?.id ?? "";
    const created = await orchestrator.createDraftPullRequest({ sessionId, requestingUserId: "U1", slackChannelId: "C1" });
    const createdMetadata = orchestrator.getSession(sessionId)?.draftPullRequest;
    assert.equal(created.operation, "created");
    assert.equal(createdMetadata?.createdBySlackUserId, "U1");

    const beforeFollowUpRuns = runner.tasks.length;
    const updated = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.11" },
      requestingUserId: "U1",
      text: "update PR"
    });

    assert.equal(updated.kind, "pull_request");
    assert.equal(runner.tasks.length, beforeFollowUpRuns);

    if (updated.kind !== "pull_request") {
      throw new Error("Expected update PR follow-up to return pull_request result.");
    }

    assert.equal(updated.lifecycle.operation, "updated");
    assert.equal(updated.lifecycle.result.prUrl, created.result.prUrl);
    assert.deepEqual(prInputs, [{ existing: false }, { existing: true }]);

    const updatedMetadata = orchestrator.getSession(sessionId)?.draftPullRequest;
    assert.equal(updatedMetadata?.createdAt, createdMetadata?.createdAt);
    assert.equal(updatedMetadata?.createdBySlackUserId, "U1");
    assert.equal(updatedMetadata?.updatedBySlackUserId, "U1");
    assert.equal(updatedMetadata?.commitSha, "b".repeat(40));
    assert.equal(
      orchestrator.listAuditEventsForSlackUser("U1").some((event) => event.type === "pr.updated"),
      true
    );

    const status = await orchestrator.getDraftPullRequestStatusForSlackUser({
      sessionId,
      requestingUserId: "U1",
      slackChannelId: "C1"
    });
    assert.equal(status.checksSummary, "All 2 status check(s) passed.");
    const statusEvent = orchestrator.listAuditEventsForSlackUser("U1").find((event) => event.type === "pr.status_checked");
    assert.ok(statusEvent);
    assert.equal("checkDetails" in (statusEvent.metadata ?? {}), false);
    assert.equal(JSON.stringify(statusEvent.metadata).includes("private-ci-job-name"), false);

    const readyFollowUp = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.11" },
      requestingUserId: "U1",
      text: "ready for review"
    });
    assert.equal(readyFollowUp.kind, "pr_ready");

    if (readyFollowUp.kind !== "pr_ready") {
      throw new Error("Expected ready-for-review follow-up to return pr_ready result.");
    }

    assert.equal(readyFollowUp.ready.operation, "ready");
    assert.equal(orchestrator.getSession(sessionId)?.draftPullRequest?.readyForReviewBySlackUserId, "U1");
    const readyEvent = orchestrator.listAuditEventsForSlackUser("U1").find((event) => event.type === "pr.ready_for_review");
    assert.ok(readyEvent);
    assert.equal("checkDetails" in (readyEvent.metadata ?? {}), false);
    assert.equal(JSON.stringify(readyEvent.metadata).includes("private-ready-ci-job"), false);

    const duplicateReady = await orchestrator.markDraftPullRequestReadyForReview({
      sessionId,
      requestingUserId: "U1",
      slackChannelId: "C1"
    });
    assert.equal(duplicateReady.operation, "already_ready");
    assert.equal(readyCalls, 2);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("draft PR follow-ups create PRs directly and return diff summary when clean", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-followup-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const prInputs: Array<{ existing: boolean }> = [];
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner, async (input) => {
      prInputs.push({ existing: Boolean(input.existingPullRequest) });
      return {
        title: input.title,
        body: input.body,
        branchName: input.branchName,
        commitSha: "c".repeat(40),
        prUrl: "https://github.com/example/repo/pull/9",
        changedFiles: ["src/codex-output.txt"]
      };
    });

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.13" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });
    await orchestrator.approveAndExecute(plan.approval.id, "U1");

    const beforePrFollowUpRuns = runner.tasks.length;
    const created = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.13" },
      requestingUserId: "U1",
      text: "continue by checking the current diff summary, then create a draft PR if there are file changes"
    });

    assert.equal(created.kind, "pull_request");
    assert.equal(runner.tasks.length, beforePrFollowUpRuns);

    if (created.kind !== "pull_request") {
      throw new Error("Expected draft PR follow-up to return pull_request result.");
    }

    assert.equal(created.intent, "update_pr");
    assert.equal(created.lifecycle.operation, "created");
    assert.equal(created.lifecycle.result.prUrl, "https://github.com/example/repo/pull/9");
    assert.deepEqual(prInputs, [{ existing: false }]);

    const cleanPlan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.14" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });
    await orchestrator.approveAndExecute(cleanPlan.approval.id, "U1");

    const cleanSession = orchestrator.getSessionBySlackThread({ teamId: "T1", channelId: "C1", threadTs: "1000.14" });
    assert.ok(cleanSession);
    rmSync(join(cleanSession.workspacePath, "src"), { recursive: true, force: true });
    rmSync(join(cleanSession.workspacePath, ".codex"), { force: true });

    const beforeCleanFollowUpRuns = runner.tasks.length;
    const clean = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.14" },
      requestingUserId: "U1",
      text: "create a draft PR"
    });

    assert.equal(clean.kind, "diff");
    assert.equal(runner.tasks.length, beforeCleanFollowUpRuns);

    if (clean.kind !== "diff") {
      throw new Error("Expected clean draft PR follow-up to return diff result.");
    }

    assert.equal(clean.intent, "update_pr");
    assert.deepEqual(clean.diff.changedFiles, []);
    assert.equal(orchestrator.getSession(cleanSession.id)?.draftPullRequest, undefined);
    assert.deepEqual(prInputs, [{ existing: false }]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("PR status requires an existing PR and the session owner or maintainer", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-status-auth-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(
      makeConfig(temp, sourceRepo, {
        mode: "strict",
        allowedSlackUserIds: ["U1", "U2"],
        maintainerSlackUserIds: ["UM"],
        allowedSlackChannelIds: ["C1"],
        repoPolicies: {
          default: {
            allowedSlackUserIds: ["U1", "U2"],
            allowedSlackChannelIds: ["C1"]
          }
        }
      }),
      store,
      runner,
      async (input) => ({
        title: input.title,
        body: input.body,
        branchName: input.branchName,
        commitSha: "a".repeat(40),
        prUrl: "https://github.com/example/repo/pull/9",
        changedFiles: ["src/codex-output.txt"]
      }),
      async (input) => ({
        prUrl: input.prUrl,
        checksSummary: "No status checks reported.",
        checksTotal: 0,
        checksPassed: 0,
        checksFailed: 0,
        checksPending: 0,
        checkedAt: new Date().toISOString()
      }),
      async (input) => ({
        prUrl: input.prUrl,
        state: "OPEN",
        isDraft: false,
        headRefName: input.branchName,
        checksSummary: "No status checks reported.",
        checksTotal: 0,
        checksPassed: 0,
        checksFailed: 0,
        checksPending: 0,
        checkedAt: new Date().toISOString(),
        operation: "ready"
      })
    );

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.12" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });
    await orchestrator.approveAndExecute(plan.approval.id, "U1");

    const sessionId = orchestrator.listSessions()[0]?.id ?? "";
    await assert.rejects(
      () =>
        orchestrator.getDraftPullRequestStatusForSlackUser({
          sessionId,
          requestingUserId: "U1",
          slackChannelId: "C1"
        }),
      /No draft PR exists/
    );

    await orchestrator.createDraftPullRequest({ sessionId, requestingUserId: "U1", slackChannelId: "C1" });
    await assert.rejects(
      () =>
        orchestrator.getDraftPullRequestStatusForSlackUser({
          sessionId,
          requestingUserId: "U2",
          slackChannelId: "C1"
        }),
      /Only the Slack user/
    );
    await assert.rejects(
      () =>
        orchestrator.markDraftPullRequestReadyForReview({
          sessionId,
          requestingUserId: "U2",
          slackChannelId: "C1"
        }),
      /Only the Slack user/
    );

    const maintainerStatus = await orchestrator.getDraftPullRequestStatusForSlackUser({
      sessionId,
      requestingUserId: "UM",
      slackChannelId: "C1"
    });
    assert.equal(maintainerStatus.checksTotal, 0);
    const maintainerReady = await orchestrator.markDraftPullRequestReadyForReview({
      sessionId,
      requestingUserId: "UM",
      slackChannelId: "C1"
    });
    assert.equal(maintainerReady.operation, "ready");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("PR status syncs local ready-for-review metadata when GitHub is already ready", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-status-ready-sync-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(
      makeConfig(temp, sourceRepo),
      store,
      runner,
      async (input) => ({
        title: input.title,
        body: input.body,
        branchName: input.branchName,
        commitSha: "a".repeat(40),
        prUrl: "https://github.com/example/repo/pull/9",
        changedFiles: ["src/codex-output.txt"]
      }),
      async (input) => ({
        prUrl: input.prUrl,
        state: "OPEN",
        isDraft: false,
        headRefName: "codex/slack/test",
        checksSummary: "No status checks reported.",
        checksTotal: 0,
        checksPassed: 0,
        checksFailed: 0,
        checksPending: 0,
        checkedAt: new Date().toISOString()
      })
    );

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.13" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });
    await orchestrator.approveAndExecute(plan.approval.id, "U1");
    const sessionId = orchestrator.listSessions()[0]?.id ?? "";
    await orchestrator.createDraftPullRequest({ sessionId, requestingUserId: "U1", slackChannelId: "C1" });

    assert.equal(orchestrator.getSession(sessionId)?.draftPullRequest?.readyForReviewAt, undefined);
    const status = await orchestrator.getDraftPullRequestStatusForSlackUser({
      sessionId,
      requestingUserId: "U1",
      slackChannelId: "C1"
    });
    assert.equal(status.isDraft, false);
    assert.equal(orchestrator.getSession(sessionId)?.draftPullRequest?.readyForReviewBySlackUserId, "U1");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("follow-up continue reuses the session after completion", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-followup-continue-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.1" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });
    await orchestrator.approveAndExecute(plan.approval.id, "U1");

    const followUp = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.1" },
      requestingUserId: "U1",
      text: "continue by inspecting the current changes"
    });

    assert.equal(followUp.kind, "plan");

    if (followUp.kind === "plan") {
      assert.equal(followUp.intent, "continue");
      assert.equal(followUp.approval.type, "execute_plan");
    }

    const session = orchestrator.listSessions()[0];
    assert.equal(runner.tasks.at(-1)?.sessionId, session?.id);
    assert.equal(runner.tasks.at(-1)?.codexSessionId, `codex-${session?.id}`);
    assert.equal(runner.tasks.at(-1)?.workspacePath, session?.workspacePath);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("continue does not duplicate a pending approval", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-followup-pending-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.2" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });

    const beforeRuns = runner.tasks.length;
    const followUp = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.2" },
      requestingUserId: "U1",
      text: "continue"
    });

    assert.equal(followUp.kind, "guidance");
    assert.equal(runner.tasks.length, beforeRuns);
    assert.equal([...store.approvals.values()].filter((approval) => approval.status === "pending").length, 1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("revise plan supersedes stale pending approvals", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-followup-revise-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    const first = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.3" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });

    runner.onStart = (task) => {
      if (task.mode === "plan" && runner.tasks.length > 1) {
        assert.equal(orchestrator.getApproval(first.approval.id)?.status, "rejected");
      }
    };

    const revised = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.3" },
      requestingUserId: "U1",
      text: "revise the plan to keep the change smaller"
    });

    assert.equal(revised.kind, "plan");

    if (revised.kind === "plan") {
      assert.equal(revised.intent, "revise_plan");
      assert.deepEqual(revised.supersededApprovalIds, [first.approval.id]);
      assert.equal(revised.approval.status, "pending");
    }

    assert.equal(orchestrator.getApproval(first.approval.id)?.status, "rejected");
    assert.equal(
      store.listAuditEvents().some((event) => event.type === "approval.rejected" && event.approvalId === first.approval.id),
      true
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("run tests follow-up creates an approval-gated test run", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-followup-tests-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.4" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });
    await orchestrator.approveAndExecute(plan.approval.id, "U1");

    const testPlan = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.4" },
      requestingUserId: "U1",
      text: "run tests"
    });

    assert.equal(testPlan.kind, "plan");

    if (testPlan.kind !== "plan") {
      throw new Error("Expected run tests follow-up to create a plan.");
    }

    assert.equal(testPlan.intent, "run_tests");
    assert.equal(testPlan.approval.type, "run_tests");

    const executed = await orchestrator.approveAndExecute(testPlan.approval.id, "U1");
    assert.equal(executed.implementRun.mode, "test");
    assert.equal(executed.runnerResult.finalMessage, "Summary: tests passed");
    assert.equal(runner.tasks.at(-1)?.mode, "test");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("summarize diff and cancel follow-ups do not start runner tasks", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-followup-readonly-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.5" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });
    await orchestrator.approveAndExecute(plan.approval.id, "U1");

    const beforeDiffRuns = runner.tasks.length;
    const diff = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.5" },
      requestingUserId: "U1",
      text: "summarize diff"
    });

    assert.equal(diff.kind, "diff");
    assert.equal(runner.tasks.length, beforeDiffRuns);

    const cancel = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.5" },
      requestingUserId: "U1",
      text: "cancel"
    });

    assert.equal(cancel.kind, "cancel");
    assert.equal(runner.tasks.length, beforeDiffRuns);
    assert.equal(orchestrator.listSessions()[0]?.status, "cancelled");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("unsupported and unauthorized follow-ups do not start runner tasks", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-followup-guard-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.6" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });

    const beforeUnsupportedRuns = runner.tasks.length;
    const unsupported = await orchestrator.handleFollowUpFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.6" },
      requestingUserId: "U1",
      text: "hello there"
    });

    assert.equal(unsupported.kind, "guidance");
    assert.equal(runner.tasks.length, beforeUnsupportedRuns);

    await assert.rejects(
      () =>
        orchestrator.handleFollowUpFromSlack({
          thread: { teamId: "T1", channelId: "C1", threadTs: "1001.6" },
          requestingUserId: "U2",
          text: "summarize diff"
        }),
      /Only the Slack user/
    );
    assert.equal(runner.tasks.length, beforeUnsupportedRuns);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("non-owner follow-ups cannot mutate pending approvals", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-followup-owner-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(
      makeConfig(temp, sourceRepo, {
        mode: "strict",
        allowedSlackUserIds: ["U1", "U2"],
        maintainerSlackUserIds: [],
        allowedSlackChannelIds: ["C1"],
        repoPolicies: {
          default: {
            allowedSlackUserIds: ["U1", "U2"],
            allowedSlackChannelIds: ["C1"]
          }
        }
      }),
      store,
      runner
    );

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.7" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });
    const beforeRuns = runner.tasks.length;

    for (const text of ["continue", "revise plan", "run tests"]) {
      await assert.rejects(
        () =>
          orchestrator.handleFollowUpFromSlack({
            thread: { teamId: "T1", channelId: "C1", threadTs: "1001.7" },
            requestingUserId: "U2",
            text
          }),
        /Only the Slack user/
      );
    }

    assert.equal(orchestrator.getApproval(plan.approval.id)?.status, "pending");
    assert.equal(runner.tasks.length, beforeRuns);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("failed revised plan preserves the prior pending approval", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-followup-revise-fail-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1001.8" },
      requestingUserId: "U1",
      text: "repo:default add a generated output file"
    });

    await assert.rejects(
      () =>
        orchestrator.handleFollowUpFromSlack({
          thread: { teamId: "T1", channelId: "C1", threadTs: "1001.8" },
          requestingUserId: "U1",
          text: "revise plan repo:other"
        }),
      /Repo 'other' is not configured|already bound to repo:default/
    );

    assert.equal(orchestrator.getApproval(plan.approval.id)?.status, "pending");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("test completion blocks do not expose PR creation and diff summaries are capped", async () => {
  const session = {
    id: "session-1",
    repoId: "default",
    branchName: "codex/slack/test"
  } as Session;
  const diff = {
    changedFiles: Array.from({ length: 60 }, (_, index) => `src/file-${index}.ts`),
    diffStat: "",
    nameStatus: "",
    patchPreview: ""
  };
  const testBlocks = completionBlocks({
    session,
    summary: "Summary: tests passed",
    diff,
    mode: "test"
  });
  const renderedTestBlocks = JSON.stringify(testBlocks);

  assert.equal(renderedTestBlocks.includes("Create PR"), false);
  assert.equal(renderedTestBlocks.includes("Update PR"), false);
  assert.equal(renderedTestBlocks.includes("PR status"), false);
  assert.equal(renderedTestBlocks.includes("... 35 more file(s) hidden"), true);

  const prBlocks = completionBlocks({
    session: {
      ...session,
      draftPullRequest: {
        title: "Codex: test",
        body: "body",
        branchName: "codex/slack/test",
        commitSha: "a".repeat(40),
        prUrl: "https://github.com/example/repo/pull/10",
        changedFiles: ["src/file-1.ts"],
        createdAt: new Date().toISOString(),
        createdBySlackUserId: "U1"
      }
    } as Session,
    summary: "Summary: implemented",
    diff
  });
  const renderedPrBlocks = JSON.stringify(prBlocks);
  assert.equal(renderedPrBlocks.includes("Update PR"), true);
  assert.equal(renderedPrBlocks.includes("PR status"), true);
  assert.equal(renderedPrBlocks.includes("Ready for review"), true);
  assert.equal(renderedPrBlocks.includes("Open PR"), true);

  const readyPrBlocks = completionBlocks({
    session: {
      ...session,
      draftPullRequest: {
        title: "Codex: test",
        body: "body",
        branchName: "codex/slack/test",
        commitSha: "a".repeat(40),
        prUrl: "https://github.com/example/repo/pull/10",
        changedFiles: ["src/file-1.ts"],
        createdAt: new Date().toISOString(),
        createdBySlackUserId: "U1",
        readyForReviewAt: new Date().toISOString(),
        readyForReviewBySlackUserId: "U1"
      }
    } as Session,
    summary: "Summary: implemented",
    diff
  });
  assert.equal(JSON.stringify(readyPrBlocks).includes("Ready for review"), false);

  const lifecycleBlocks = prLifecycleBlocks({
    lifecycle: {
      operation: "created",
      result: {
        title: "Codex: test",
        body: "body",
        branchName: "codex/slack/test",
        commitSha: "a".repeat(40),
        prUrl: "https://github.com/example/repo/pull/10",
        changedFiles: ["src/file-1.ts"]
      }
    },
    session: {
      ...session,
      draftPullRequest: {
        title: "Codex: test",
        body: "body",
        branchName: "codex/slack/test",
        commitSha: "a".repeat(40),
        prUrl: "https://github.com/example/repo/pull/10",
        changedFiles: ["src/file-1.ts"],
        createdAt: new Date().toISOString(),
        createdBySlackUserId: "U1"
      }
    } as Session
  });
  assert.equal(JSON.stringify(lifecycleBlocks).includes("Ready for review"), true);

  const statusBlocks = prStatusBlocks({
    status: {
      prUrl: "https://github.com/example/repo/pull/10",
      state: "OPEN",
      isDraft: true,
      checksSummary: "8/12 passed, 1 failed, 3 pending.",
      checksTotal: 12,
      checksPassed: 8,
      checksFailed: 1,
      checksPending: 3,
      checkDetails: Array.from({ length: 10 }, (_item, index) => ({
        name: index === 0 ? "test|linux" : `check-${index + 1}`,
        state: index === 1 ? "failed" : "passed",
        conclusion: index === 1 ? "FAILURE" : "SUCCESS",
        url: index === 0 ? "https://github.com/example/repo/actions/runs/1" : undefined
      })),
      checksHidden: 2,
      checkedAt: new Date().toISOString()
    },
    session
  });
  const renderedStatusBlocks = JSON.stringify(statusBlocks);
  assert.equal(renderedStatusBlocks.includes("Check details"), true);
  assert.equal(renderedStatusBlocks.includes("test/linux"), true);
  assert.equal(renderedStatusBlocks.includes("[failed]"), true);
  assert.equal(renderedStatusBlocks.includes("... 4 more check(s) hidden"), true);

  const diffBlocks = diffSummaryBlocks({ session, diff });
  assert.equal(JSON.stringify(diffBlocks).includes("... 35 more file(s) hidden"), true);
});

test("task owner is required for approval and cancellation", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-auth-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(makeConfig(temp, sourceRepo), store, runner);

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.2" },
      requestingUserId: "U1",
      text: "repo:default make a change"
    });

    await assert.rejects(() => orchestrator.approveAndExecute(plan.approval.id, "U2"), /Only the Slack user/);
    await assert.rejects(
      () =>
        orchestrator.cancelSessionBySlackThread({
          teamId: "T1",
          channelId: "C1",
          threadTs: "1000.2",
          requestingUserId: "U2"
        }),
      /Only the Slack user/
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("orchestrator denies unauthorized Slack users before creating sessions or runs", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-policy-deny-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(
      makeConfig(temp, sourceRepo, {
        mode: "strict",
        allowedSlackUserIds: ["U1"],
        maintainerSlackUserIds: [],
        allowedSlackChannelIds: ["C1"],
        repoPolicies: {
          default: {
            allowedSlackUserIds: ["U1"],
            allowedSlackChannelIds: ["C1"]
          }
        }
      }),
      store,
      runner
    );

    await assert.rejects(
      () =>
        orchestrator.startPlanFromSlack({
          thread: { teamId: "T1", channelId: "C1", threadTs: "1000.3" },
          requestingUserId: "U2",
          text: "repo:default make a change"
        }),
      /not authorized/i
    );
    assert.equal(orchestrator.listSessions().length, 0);
    assert.equal(runner.tasks.length, 0);
    assert.equal(
      store.listAuditEvents().some((event) => event.type === "authorization.denied" && event.actorSlackUserId === "U2"),
      true
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("configured maintainers can approve owner tasks but unauthorized users cannot", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-policy-maintainer-"));

  try {
    const sourceRepo = join(temp, "source");
    mkdirSync(sourceRepo);
    await initRepo(sourceRepo);

    const runner = new FakeRunner();
    const store = new InMemoryStore();
    const orchestrator = new Orchestrator(
      makeConfig(temp, sourceRepo, {
        mode: "strict",
        allowedSlackUserIds: ["U1"],
        maintainerSlackUserIds: ["UM"],
        allowedSlackChannelIds: ["C1"],
        repoPolicies: {
          default: {
            allowedSlackUserIds: ["U1"],
            allowedSlackChannelIds: ["C1"]
          }
        }
      }),
      store,
      runner
    );

    const plan = await orchestrator.startPlanFromSlack({
      thread: { teamId: "T1", channelId: "C1", threadTs: "1000.4" },
      requestingUserId: "U1",
      text: "repo:default make a change"
    });

    await assert.rejects(() => orchestrator.approveAndExecute(plan.approval.id, "U2"), /not authorized/i);

    const executed = await orchestrator.approveAndExecute(plan.approval.id, "UM");
    assert.equal(executed.runnerResult.status, "completed");
    assert.equal(orchestrator.listSessions()[0]?.status, "done");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

async function initRepo(repoPath: string): Promise<void> {
  await runGit(["init"], repoPath);
  await runGit(["config", "user.email", "test@example.com"], repoPath);
  await runGit(["config", "user.name", "Test User"], repoPath);
  writeFileSync(join(repoPath, "README.md"), "# test\n", "utf8");
  await runGit(["add", "README.md"], repoPath);
  await runGit(["commit", "-m", "init"], repoPath);
}

function sampleSession(overrides: Partial<Session> = {}): Session {
  const id = overrides.id ?? "session-1";

  return {
    id,
    slackThreadKey: `T1:C1:${id}`,
    ownerSlackUserId: "U1",
    repoId: "default",
    sourceRepoPath: "/tmp/source",
    workspacePath: "/tmp/worktree",
    workspaceKind: "worktree",
    branchName: `codex/slack/${id}`,
    runnerKind: "exec",
    status: "done",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeConfig(
  temp: string,
  sourceRepo: string,
  policy: HarnessPolicyConfig = {
    mode: "local-dev",
    allowedSlackUserIds: [],
    maintainerSlackUserIds: [],
    allowedSlackChannelIds: [],
    repoPolicies: {}
  }
): HarnessConfig {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: ""
    },
    codex: {
      command: "codex",
      worktreeRoot: join(temp, "worktrees"),
      statePath: join(temp, "state.json"),
      runnerEnvAllowlist: ["PATH", "HOME", "NO_COLOR"],
      profilesPath: join(temp, "profiles.toml"),
      rulesPath: join(temp, "default.rules"),
      requireExecPolicyCheck: true,
      storeKind: "json",
      databasePath: join(temp, "state.db"),
      directWorkspace: {
        enabled: false,
        allowedRepoIds: [],
        requireClean: true
      }
    },
    repos: [{ id: "default", path: sourceRepo }],
    defaultRepoId: "default",
    policy
  };
}
