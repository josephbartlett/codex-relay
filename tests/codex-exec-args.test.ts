import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexExecArgs, buildCodexExecResumeArgs, runnerProfileForTask } from "../apps/local-runner/src/codex/exec.js";
import type { RunnerTaskSpec } from "../packages/shared/src/types.js";

const task: RunnerTaskSpec = {
  runId: "r1",
  sessionId: "s1",
  mode: "plan",
  prompt: "inspect the repo",
  workspacePath: "/tmp/repo",
  sandbox: "read-only",
  approvalPolicy: "never"
};

test("codex exec args match installed non-interactive CLI", () => {
  const args = buildCodexExecArgs(task);

  assert.deepEqual(args.slice(0, 4), ["exec", "--json", "--color", "never"]);
  assert.deepEqual(args.slice(args.indexOf("--cd"), args.indexOf("--cd") + 4), ["--cd", "/tmp/repo", "--sandbox", "read-only"]);
  assert.deepEqual(args.slice(args.indexOf("--profile"), args.indexOf("--profile") + 2), ["--profile", "codex_relay_readonly"]);
  assert.equal(args.includes("--ask-for-approval"), false);
  assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  assert.equal(args.includes("sandbox_workspace_write.network_access=false"), true);
  assert.equal(args.at(-1), "inspect the repo");
});

test("codex exec resume args keep parent exec options before resume command", () => {
  const args = buildCodexExecResumeArgs(task, "session-123");

  assert.deepEqual(args.slice(0, 4), ["exec", "--json", "--color", "never"]);
  assert.deepEqual(args.slice(args.indexOf("--cd"), args.indexOf("--cd") + 4), ["--cd", "/tmp/repo", "--sandbox", "read-only"]);
  assert.deepEqual(args.slice(args.indexOf("--profile"), args.indexOf("--profile") + 2), ["--profile", "codex_relay_readonly"]);
  assert.equal(args.includes("--ask-for-approval"), false);
  assert.deepEqual(args.slice(-3), ["resume", "session-123", "inspect the repo"]);
});

test("runner profile follows task mode", () => {
  assert.equal(runnerProfileForTask({ ...task, mode: "plan", sandbox: "read-only" }), "codex_relay_readonly");
  assert.equal(runnerProfileForTask({ ...task, mode: "review", sandbox: "read-only" }), "codex_relay_readonly");
  assert.equal(runnerProfileForTask({ ...task, mode: "implement", sandbox: "workspace-write" }), "codex_relay_write");
  assert.equal(runnerProfileForTask({ ...task, mode: "test", sandbox: "workspace-write" }), "codex_relay_write");
});
