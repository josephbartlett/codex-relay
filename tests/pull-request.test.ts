import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildPullRequestBody,
  buildPullRequestTitle,
  createDraftPullRequest,
  extractPrUrl,
  getDraftPullRequestStatus,
  markDraftPullRequestReadyForReview,
  parsePullRequestStatus
} from "../apps/local-runner/src/pullRequest.js";
import { runGit, type CommandResult } from "../apps/local-runner/src/git.js";

test("extractPrUrl finds GitHub PR URLs in gh output", () => {
  assert.equal(
    extractPrUrl("Creating pull request\nhttps://github.com/example/repo/pull/123\n"),
    "https://github.com/example/repo/pull/123"
  );
});

test("pull request title and body sanitize Codex markdown summaries", () => {
  const summary = [
    "**Summary**",
    "Implemented exponentiation support for the calculator.",
    "",
    "- [src/calculator.js](/home/example/repo/src/calculator.js): added power."
  ].join("\n");

  assert.equal(buildPullRequestTitle(summary, "session-1"), "Codex: Implemented exponentiation support for the calculator.");
  const body = buildPullRequestBody({
      sessionId: "session-1",
      repoId: "default",
      branchName: "codex/slack/test",
      summary,
      changedFiles: ["src/calculator.js", "src/weird`name.ts"]
    });

  assert.equal(body.includes("[src/calculator.js](/home/example"), false);
  assert.equal(body.startsWith("## Summary\nImplemented exponentiation support"), true);
  assert.match(body, /- `src\/weird'name\.ts`/);
});

test("createDraftPullRequest commits, pushes, and calls gh with draft arguments", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-"));

  try {
    const remote = join(temp, "remote.git");
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await runGit(["init", "--bare", remote], temp);
    await initRepo(repo);
    await runGit(["remote", "add", "origin", remote], repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    writeFileSync(join(repo, "new-file.txt"), "new\n", "utf8");

    const ghCalls: string[][] = [];
    const result = await createDraftPullRequest(
      {
        workspacePath: repo,
        branchName: "codex/slack/test",
        title: "Codex: add new file",
        body: "body"
      },
      {
        git: runGit,
        async gh(args: string[], _cwd: string): Promise<CommandResult> {
          ghCalls.push(args);
          return { stdout: "https://github.com/example/repo/pull/42\n", stderr: "" };
        }
      }
    );

    assert.equal(result.prUrl, "https://github.com/example/repo/pull/42");
    assert.equal(result.changedFiles.includes("new-file.txt"), true);
    assert.match(result.commitSha, /^[0-9a-f]{40}$/);
    assert.deepEqual(ghCalls[0]?.slice(0, 3), ["pr", "create", "--draft"]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest updates existing draft PR instead of creating a duplicate", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-update-"));

  try {
    const remote = join(temp, "remote.git");
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await runGit(["init", "--bare", remote], temp);
    await initRepo(repo);
    await runGit(["remote", "add", "origin", remote], repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    const initialHead = (await runGit(["rev-parse", "HEAD"], repo)).stdout.trim();
    writeFileSync(join(repo, "follow-up.txt"), "follow-up\n", "utf8");

    const ghCalls: string[][] = [];
    const existingPullRequest = {
      title: "Codex: initial",
      body: "initial body",
      branchName: "codex/slack/test",
      commitSha: initialHead,
      prUrl: "https://github.com/example/repo/pull/42",
      changedFiles: ["initial.txt"]
    };
    const result = await createDraftPullRequest(
      {
        workspacePath: repo,
        branchName: "codex/slack/test",
        title: "Codex: follow-up",
        body: "updated body",
        existingPullRequest
      },
      {
        git: gitWithGithubOrigin("https://github.com/example/repo.git"),
        async gh(args: string[], _cwd: string): Promise<CommandResult> {
          ghCalls.push(args);
          return { stdout: "", stderr: "" };
        }
      }
    );

    assert.equal(result.prUrl, existingPullRequest.prUrl);
    assert.equal(result.changedFiles.includes("follow-up.txt"), true);
    assert.match(result.commitSha, /^[0-9a-f]{40}$/);
    assert.notEqual(result.commitSha, existingPullRequest.commitSha);
    assert.equal(ghCalls.some((args) => args[0] === "pr" && args[1] === "create"), false);
    assert.deepEqual(ghCalls[0]?.slice(0, 4), ["pr", "edit", existingPullRequest.prUrl, "--title"]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest returns existing PR unchanged for clean existing PR worktrees", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-clean-existing-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    const headSha = (await runGit(["rev-parse", "HEAD"], repo)).stdout.trim();

    const ghCalls: string[][] = [];
    const existingPullRequest = {
      title: "Codex: initial",
      body: "initial body",
      branchName: "codex/slack/test",
      commitSha: headSha,
      prUrl: "https://github.com/example/repo/pull/42",
      changedFiles: ["initial.txt"]
    };
    const result = await createDraftPullRequest(
      {
        workspacePath: repo,
        branchName: "codex/slack/test",
        title: "Codex: no-op",
        body: "no-op body",
        existingPullRequest
      },
      {
        git: gitWithGithubOrigin("https://github.com/example/repo.git"),
        async gh(args: string[], _cwd: string): Promise<CommandResult> {
          ghCalls.push(args);
          return { stdout: "", stderr: "" };
        }
      }
    );

    assert.deepEqual(result, existingPullRequest);
    assert.deepEqual(ghCalls, []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest ignores Codex marker-only changes when updating existing PR", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-marker-existing-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    const headSha = (await runGit(["rev-parse", "HEAD"], repo)).stdout.trim();
    writeFileSync(join(repo, ".codex"), "", "utf8");

    const ghCalls: string[][] = [];
    const existingPullRequest = {
      title: "Codex: initial",
      body: "initial body",
      branchName: "codex/slack/test",
      commitSha: headSha,
      prUrl: "https://github.com/example/repo/pull/42",
      changedFiles: ["initial.txt"]
    };
    const result = await createDraftPullRequest(
      {
        workspacePath: repo,
        branchName: "codex/slack/test",
        title: "Codex: no-op",
        body: "no-op body",
        existingPullRequest
      },
      {
        git: gitWithGithubOrigin("https://github.com/example/repo.git"),
        async gh(args: string[], _cwd: string): Promise<CommandResult> {
          ghCalls.push(args);
          return { stdout: "", stderr: "" };
        }
      }
    );

    assert.deepEqual(result, existingPullRequest);
    assert.deepEqual(ghCalls, []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest rejects missing PR URL when updating existing PR", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-missing-url-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    writeFileSync(join(repo, "follow-up.txt"), "follow-up\n", "utf8");

    const ghCalls: string[][] = [];
    await assert.rejects(
      () =>
        createDraftPullRequest(
          {
            workspacePath: repo,
            branchName: "codex/slack/test",
            title: "Codex: follow-up",
            body: "updated body",
            existingPullRequest: {
              title: "Codex: initial",
              body: "initial body",
              branchName: "codex/slack/test",
              commitSha: "a".repeat(40),
              prUrl: "",
              changedFiles: ["initial.txt"]
            }
          },
          {
            git: runGit,
            async gh(args: string[], _cwd: string): Promise<CommandResult> {
              ghCalls.push(args);
              return { stdout: "", stderr: "" };
            }
          }
        ),
      /missing a PR URL/
    );
    assert.deepEqual(ghCalls, []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest rejects mismatched existing PR branch metadata", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-branch-mismatch-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);

    await assert.rejects(
      () =>
        createDraftPullRequest({
          workspacePath: repo,
          branchName: "codex/slack/test",
          title: "Codex: no-op",
          body: "no-op body",
          existingPullRequest: {
            title: "Codex: initial",
            body: "initial body",
            branchName: "codex/slack/other",
            commitSha: "a".repeat(40),
            prUrl: "https://github.com/example/repo/pull/42",
            changedFiles: ["initial.txt"]
          }
        }),
      /does not match expected branch/
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest rejects existing PR URLs outside the origin repo", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-origin-mismatch-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);

    const ghCalls: string[][] = [];
    await assert.rejects(
      () =>
        createDraftPullRequest(
          {
            workspacePath: repo,
            branchName: "codex/slack/test",
            title: "Codex: no-op",
            body: "no-op body",
            existingPullRequest: {
              title: "Codex: initial",
              body: "initial body",
              branchName: "codex/slack/test",
              commitSha: "a".repeat(40),
              prUrl: "https://github.com/other/repo/pull/42",
              changedFiles: ["initial.txt"]
            }
          },
          {
            git: gitWithGithubOrigin("https://github.com/example/repo.git"),
            async gh(args: string[], _cwd: string): Promise<CommandResult> {
              ghCalls.push(args);
              return { stdout: "", stderr: "" };
            }
          }
        ),
      /does not match this worktree's origin/
    );
    assert.deepEqual(ghCalls, []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest rejects detached HEAD worktrees", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-detached-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    await runGit(["checkout", "--detach"], repo);
    writeFileSync(join(repo, "detached.txt"), "detached\n", "utf8");

    await assert.rejects(
      () =>
        createDraftPullRequest({
          workspacePath: repo,
          branchName: "codex/slack/test",
          title: "Codex: detached",
          body: "body"
        }),
      /detached HEAD/
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest rejects pre-staged index changes", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-staged-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    writeFileSync(join(repo, "staged.txt"), "staged\n", "utf8");
    await runGit(["add", "staged.txt"], repo);

    await assert.rejects(
      () =>
        createDraftPullRequest({
          workspacePath: repo,
          branchName: "codex/slack/test",
          title: "Codex: staged",
          body: "body"
        }),
      /pre-staged changes/
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest rejects clean recovery when local HEAD is not upstream-backed", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-unpushed-recovery-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    const initialHead = (await runGit(["rev-parse", "HEAD"], repo)).stdout.trim();
    writeFileSync(join(repo, "manual.txt"), "manual\n", "utf8");
    await runGit(["add", "manual.txt"], repo);
    await runGit(["commit", "-m", "manual advance"], repo);

    await assert.rejects(
      () =>
        createDraftPullRequest(
          {
            workspacePath: repo,
            branchName: "codex/slack/test",
            title: "Codex: unsafe recovery",
            body: "body",
            existingPullRequest: {
              title: "Codex: initial",
              body: "initial body",
              branchName: "codex/slack/test",
              commitSha: initialHead,
              prUrl: "https://github.com/example/repo/pull/42",
              changedFiles: ["initial.txt"]
            }
          },
          {
            git: gitWithGithubOrigin("https://github.com/example/repo.git"),
            async gh(): Promise<CommandResult> {
              throw new Error("gh should not be called");
            }
          }
        ),
      /no upstream tracking branch/
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest rejects branches behind upstream before PR handoff", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-behind-"));

  try {
    const remote = join(temp, "remote.git");
    const repo = join(temp, "repo");
    const other = join(temp, "other");
    mkdirSync(repo);
    await runGit(["init", "--bare", remote], temp);
    await initRepo(repo);
    await runGit(["remote", "add", "origin", remote], repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    await runGit(["push", "-u", "origin", "codex/slack/test"], repo);

    await runGit(["clone", remote, other], temp);
    await runGit(["config", "user.email", "test@example.com"], other);
    await runGit(["config", "user.name", "Test User"], other);
    await runGit(["checkout", "codex/slack/test"], other);
    writeFileSync(join(other, "remote.txt"), "remote\n", "utf8");
    await runGit(["add", "remote.txt"], other);
    await runGit(["commit", "-m", "remote advance"], other);
    await runGit(["push", "origin", "codex/slack/test"], other);

    await runGit(["fetch", "origin", "codex/slack/test"], repo);
    writeFileSync(join(repo, "local.txt"), "local\n", "utf8");

    await assert.rejects(
      () =>
        createDraftPullRequest({
          workspacePath: repo,
          branchName: "codex/slack/test",
          title: "Codex: local",
          body: "body"
        }),
      /behind upstream/
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest recovers a pushed update after gh pr edit failure", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-edit-retry-"));

  try {
    const remote = join(temp, "remote.git");
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await runGit(["init", "--bare", remote], temp);
    await initRepo(repo);
    await runGit(["remote", "add", "origin", remote], repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    const initialHead = (await runGit(["rev-parse", "HEAD"], repo)).stdout.trim();
    writeFileSync(join(repo, "follow-up.txt"), "follow-up\n", "utf8");

    const ghCalls: string[][] = [];
    const existingPullRequest = {
      title: "Codex: initial",
      body: "initial body",
      branchName: "codex/slack/test",
      commitSha: initialHead,
      prUrl: "https://github.com/example/repo/pull/42",
      changedFiles: ["initial.txt"]
    };
    const runner = {
      git: gitWithGithubOrigin("https://github.com/example/repo.git"),
      async gh(args: string[], _cwd: string): Promise<CommandResult> {
        ghCalls.push(args);

        if (ghCalls.length === 1) {
          throw new Error("temporary gh failure");
        }

        return { stdout: "", stderr: "" };
      }
    };

    await assert.rejects(
      () =>
        createDraftPullRequest(
          {
            workspacePath: repo,
            branchName: "codex/slack/test",
            title: "Codex: follow-up",
            body: "updated body",
            existingPullRequest
          },
          runner
        ),
      /temporary gh failure/
    );

    assert.equal((await runGit(["status", "--porcelain"], repo)).stdout.trim(), "");
    const retry = await createDraftPullRequest(
      {
        workspacePath: repo,
        branchName: "codex/slack/test",
        title: "Codex: follow-up",
        body: "updated body",
        existingPullRequest
      },
      runner
    );

    assert.equal(retry.prUrl, existingPullRequest.prUrl);
    assert.notEqual(retry.commitSha, existingPullRequest.commitSha);
    assert.deepEqual(retry.changedFiles, ["follow-up.txt"]);
    assert.equal(ghCalls.length, 2);
    assert.deepEqual(ghCalls[1]?.slice(0, 3), ["pr", "edit", existingPullRequest.prUrl]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("getDraftPullRequestStatus summarizes gh status checks", async () => {
  const result = await getDraftPullRequestStatus(
    {
      workspacePath: "/tmp/repo",
      prUrl: "https://github.com/example/repo/pull/42"
    },
    {
      git: gitWithGithubOrigin("https://github.com/example/repo.git"),
      async gh(args: string[], _cwd: string): Promise<CommandResult> {
        assert.deepEqual(args, [
          "pr",
          "view",
          "https://github.com/example/repo/pull/42",
          "--json",
          "state,isDraft,mergeable,statusCheckRollup,url,headRefName"
        ]);
        return {
          stdout: JSON.stringify({
            url: "https://github.com/example/repo/pull/42",
            state: "OPEN",
            isDraft: true,
            mergeable: "MERGEABLE",
            headRefName: "codex/slack/test",
            statusCheckRollup: [
              {
                name: "typecheck",
                conclusion: "SUCCESS",
                status: "COMPLETED",
                detailsUrl: "https://github.com/example/repo/actions/runs/1"
              },
              { name: "test", conclusion: "FAILURE", status: "COMPLETED" },
              { name: "build", status: "IN_PROGRESS" }
            ]
          }),
          stderr: ""
        };
      }
    }
  );

  assert.equal(result.checksSummary, "1/3 passed, 1 failed, 1 pending.");
  assert.equal(result.state, "OPEN");
  assert.equal(result.isDraft, true);
  assert.equal(result.mergeable, "MERGEABLE");
  assert.equal(result.headRefName, "codex/slack/test");
  assert.deepEqual(
    result.checkDetails?.map((check) => ({ name: check.name, state: check.state })),
    [
      { name: "typecheck", state: "passed" },
      { name: "test", state: "failed" },
      { name: "build", state: "pending" }
    ]
  );
  assert.equal(result.checkDetails?.[0]?.url, "https://github.com/example/repo/actions/runs/1");
});

test("parsePullRequestStatus handles PRs without checks", () => {
  const result = parsePullRequestStatus(
    JSON.stringify({
      url: "https://github.com/example/repo/pull/43",
      state: "OPEN",
      statusCheckRollup: []
    }),
    "https://github.com/example/repo/pull/43"
  );

  assert.equal(result.checksSummary, "No status checks reported.");
  assert.equal(result.checksTotal, 0);
  assert.deepEqual(result.checkDetails, []);
});

test("parsePullRequestStatus normalizes nested status rollup variants", () => {
  const result = parsePullRequestStatus(
    JSON.stringify({
      url: "https://github.com/example/repo/pull/44",
      state: "OPEN",
      statusCheckRollup: {
        nodes: [
          { context: "legacy/status", state: "SUCCESS", targetUrl: "https://ci.example/status/1" },
          {
            status: "COMPLETED",
            conclusion: "SUCCESS",
            checkRuns: {
              nodes: [
                {
                  name: "linux build",
                  workflowName: "ci",
                  status: "COMPLETED",
                  conclusion: "SKIPPED",
                  detailsUrl: "https://github.com/example/repo/actions/runs/2"
                },
                { name: "deploy gate", status: "COMPLETED" },
                { status: "QUEUED" }
              ]
            }
          }
        ]
      }
    }),
    "https://github.com/example/repo/pull/44"
  );

  assert.equal(result.checksSummary, "2/4 passed, 1 failed, 1 pending.");
  assert.equal(result.checksTotal, 4);
  assert.equal(result.checksPassed, 2);
  assert.equal(result.checksFailed, 1);
  assert.equal(result.checksPending, 1);
  assert.deepEqual(
    result.checkDetails?.map((check) => ({
      name: check.name,
      state: check.state,
      workflowName: check.workflowName
    })),
    [
      { name: "legacy/status", state: "passed", workflowName: undefined },
      { name: "linux build", state: "skipped", workflowName: "ci" },
      { name: "deploy gate", state: "failed", workflowName: undefined },
      { name: "Unnamed check", state: "pending", workflowName: undefined }
    ]
  );
});

test("parsePullRequestStatus rejects Slack-control characters in check URLs", () => {
  const result = parsePullRequestStatus(
    JSON.stringify({
      url: "https://github.com/example/repo/pull/46",
      state: "OPEN",
      statusCheckRollup: [
        { context: "external/status", state: "SUCCESS", targetUrl: "https://ci.example/status|bad" }
      ]
    }),
    "https://github.com/example/repo/pull/46"
  );

  assert.equal(result.checksSummary, "All 1 status check(s) passed.");
  assert.equal(result.checkDetails?.[0]?.name, "external/status");
  assert.equal(result.checkDetails?.[0]?.url, undefined);
});

test("parsePullRequestStatus caps retained check details", () => {
  const result = parsePullRequestStatus(
    JSON.stringify({
      url: "https://github.com/example/repo/pull/45",
      state: "OPEN",
      statusCheckRollup: Array.from({ length: 25 }, (_item, index) => ({
        name: `check-${index + 1}`,
        status: "COMPLETED",
        conclusion: "SUCCESS"
      }))
    }),
    "https://github.com/example/repo/pull/45"
  );

  assert.equal(result.checksSummary, "All 25 status check(s) passed.");
  assert.equal(result.checkDetails?.length, 20);
  assert.equal(result.checksHidden, 5);
});

test("markDraftPullRequestReadyForReview marks draft PRs ready", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-ready-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);

    const ghCalls: string[][] = [];
    const result = await markDraftPullRequestReadyForReview(
      {
        workspacePath: repo,
        branchName: "codex/slack/test",
        prUrl: "https://github.com/example/repo/pull/42"
      },
      {
        git: gitWithGithubOrigin("https://github.com/example/repo.git"),
        async gh(args: string[], _cwd: string): Promise<CommandResult> {
          ghCalls.push(args);

          if (args[0] === "pr" && args[1] === "ready") {
            return { stdout: "", stderr: "" };
          }

          return {
            stdout: JSON.stringify({
              url: "https://github.com/example/repo/pull/42",
              state: "OPEN",
              isDraft: ghCalls.some((call) => call[0] === "pr" && call[1] === "ready") ? false : true,
              headRefName: "codex/slack/test",
              statusCheckRollup: [{ name: "test", conclusion: "SUCCESS", status: "COMPLETED" }]
            }),
            stderr: ""
          };
        }
      }
    );

    assert.equal(result.operation, "ready");
    assert.equal(result.isDraft, false);
    assert.equal(result.checksSummary, "All 1 status check(s) passed.");
    assert.deepEqual(ghCalls.map((args) => args.slice(0, 2)), [
      ["pr", "view"],
      ["pr", "ready"],
      ["pr", "view"]
    ]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("markDraftPullRequestReadyForReview is idempotent for already-ready PRs", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-ready-noop-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);

    const ghCalls: string[][] = [];
    const result = await markDraftPullRequestReadyForReview(
      {
        workspacePath: repo,
        branchName: "codex/slack/test",
        prUrl: "https://github.com/example/repo/pull/42"
      },
      {
        git: gitWithGithubOrigin("https://github.com/example/repo.git"),
        async gh(args: string[], _cwd: string): Promise<CommandResult> {
          ghCalls.push(args);
          return {
            stdout: JSON.stringify({
              url: "https://github.com/example/repo/pull/42",
              state: "OPEN",
              isDraft: false,
              headRefName: "codex/slack/test",
              statusCheckRollup: []
            }),
            stderr: ""
          };
        }
      }
    );

    assert.equal(result.operation, "already_ready");
    assert.equal(result.isDraft, false);
    assert.deepEqual(ghCalls.map((args) => args.slice(0, 2)), [["pr", "view"]]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("markDraftPullRequestReadyForReview rejects branch and origin mismatches", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-ready-mismatch-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);

    await assert.rejects(
      () =>
        markDraftPullRequestReadyForReview({
          workspacePath: repo,
          branchName: "codex/slack/other",
          prUrl: "https://github.com/example/repo/pull/42"
        }),
      /expected 'codex\/slack\/other'/
    );

    await assert.rejects(
      () =>
        markDraftPullRequestReadyForReview(
          {
            workspacePath: repo,
            branchName: "codex/slack/test",
            prUrl: "https://github.com/other/repo/pull/42"
          },
          {
            git: gitWithGithubOrigin("https://github.com/example/repo.git"),
            async gh(): Promise<CommandResult> {
              throw new Error("gh should not be called");
            }
          }
        ),
      /does not match this worktree's origin/
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("markDraftPullRequestReadyForReview rejects closed pull requests", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-ready-closed-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);

    await assert.rejects(
      () =>
        markDraftPullRequestReadyForReview(
          {
            workspacePath: repo,
            branchName: "codex/slack/test",
            prUrl: "https://github.com/example/repo/pull/42"
          },
          {
            git: gitWithGithubOrigin("https://github.com/example/repo.git"),
            async gh(): Promise<CommandResult> {
              return {
                stdout: JSON.stringify({
                  url: "https://github.com/example/repo/pull/42",
                  state: "CLOSED",
                  isDraft: true,
                  headRefName: "codex/slack/test",
                  statusCheckRollup: []
                }),
                stderr: ""
              };
            }
          }
        ),
      /must be open/
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest rejects clean worktrees", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-clean-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);

    await assert.rejects(
      () =>
        createDraftPullRequest({
          workspacePath: repo,
          branchName: "codex/slack/test",
          title: "Codex: no changes",
          body: "body"
        }),
      /No worktree changes/
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("createDraftPullRequest ignores Codex internal marker files", async () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-pr-internal-"));

  try {
    const repo = join(temp, "repo");
    mkdirSync(repo);
    await initRepo(repo);
    await runGit(["checkout", "-b", "codex/slack/test"], repo);
    writeFileSync(join(repo, ".codex"), "", "utf8");

    await assert.rejects(
      () =>
        createDraftPullRequest({
          workspacePath: repo,
          branchName: "codex/slack/test",
          title: "Codex: no user changes",
          body: "body"
        }),
      /No worktree changes/
    );
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

function gitWithGithubOrigin(originUrl: string): (args: string[], cwd: string) => Promise<CommandResult> {
  return async (args: string[], cwd: string): Promise<CommandResult> => {
    if (args.join("\0") === "remote\0get-url\0origin") {
      return { stdout: `${originUrl}\n`, stderr: "" };
    }

    return runGit(args, cwd);
  };
}
