import assert from "node:assert/strict";
import test from "node:test";
import { publishPendingSlackNotifications } from "../apps/slack-gateway/src/slackNotificationPublisher.js";
import { completionBlocks, failureBlocks, kickoffBlocks } from "../apps/slack-gateway/src/blocks/taskCards.js";
import { InMemoryStore } from "../apps/orchestrator/src/persistence/inMemory.js";
import { enqueueSlackNotification } from "../apps/orchestrator/src/slackNotifications.js";
import type { ApprovalRequest, Session } from "../packages/shared/src/types.js";

const baseNow = new Date("2026-04-13T00:00:00.000Z");

test("Slack notification publisher sends pending notifications once", async () => {
  const store = new InMemoryStore();
  const calls: unknown[] = [];
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

  const client = {
    chat: {
      postMessage: async (input: unknown) => {
        calls.push(input);
      }
    }
  };

  const first = await publishPendingSlackNotifications({
    store,
    client,
    workerId: "publisher-1",
    now: () => baseNow
  });
  const second = await publishPendingSlackNotifications({
    store,
    client,
    workerId: "publisher-1",
    now: () => baseNow
  });

  assert.deepEqual(first, { sent: 1, failed: 0, claimed: 1 });
  assert.deepEqual(second, { sent: 0, failed: 0, claimed: 0 });
  assert.equal(calls.length, 1);
  assert.equal(store.getSlackNotification(notification.id)?.status, "sent");
  assert.match(JSON.stringify(calls[0]), /"channel":"C1"/);
  assert.match(JSON.stringify(calls[0]), /"thread_ts":"1000.1"/);
});

test("Slack notification publisher renders plan approvals with action buttons", async () => {
  const store = new InMemoryStore();
  store.saveApproval(sampleApproval());
  const calls: unknown[] = [];
  enqueueSlackNotification(store, {
    kind: "plan.ready",
    severity: "success",
    slackThreadKey: "T1:C1:1000.1",
    sessionId: "session-1",
    repoId: "default",
    taskRunId: "run-1",
    approvalId: "approval-1",
    queueJobId: "job-1",
    title: "Plan ready",
    detail: "Plan: edit README",
    now: baseNow
  });

  await publishPendingSlackNotifications({
    store,
    client: {
      chat: {
        postMessage: async (input: unknown) => {
          calls.push(input);
        }
      }
    },
    workerId: "publisher-1",
    now: () => baseNow
  });

  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0]), /Approve execution/);
  assert.match(JSON.stringify(calls[0]), /approval-1/);
});

test("Slack notification publisher renders completed runner summaries with continuation actions", async () => {
  const store = new InMemoryStore();
  store.saveSession(sampleSession({ status: "done" }));
  const calls: unknown[] = [];
  enqueueSlackNotification(store, {
    kind: "runner.completed",
    severity: "success",
    slackThreadKey: "T1:C1:1000.1",
    sessionId: "session-1",
    repoId: "default",
    taskRunId: "run-1",
    queueJobId: "job-1",
    title: "Queued task completed",
    detail: "Summary: local handoff completed. Reply to continue.",
    now: baseNow
  });

  await publishPendingSlackNotifications({
    store,
    client: {
      chat: {
        postMessage: async (input: unknown) => {
          calls.push(input);
        }
      }
    },
    workerId: "publisher-1",
    now: () => baseNow
  });

  const text = JSON.stringify(calls[0]);
  assert.match(text, /Queued task completed/);
  assert.match(text, /Reply in this thread and mention Codex Relay to continue/);
  assert.match(text, /Show diff summary/);
  assert.match(text, /Create PR/);
  assert.match(text, /session-1/);
});

test("Slack notification publisher retries failed delivery without leaking token-shaped errors", async () => {
  const store = new InMemoryStore();
  let attempts = 0;
  const notification = enqueueSlackNotification(store, {
    kind: "runner.failed",
    severity: "failure",
    slackThreadKey: "T1:C1:1000.1",
    sessionId: "session-1",
    repoId: "default",
    taskRunId: "run-1",
    queueJobId: "job-1",
    title: "Queued task failed",
    detail: "Error: failed",
    now: baseNow
  });

  const client = {
    chat: {
      postMessage: async () => {
        attempts += 1;

        if (attempts === 1) {
          throw new Error("Slack rejected xoxb-1234567890-secret ghp_sensitive123 sk-sensitive123");
        }
      }
    }
  };

  const failed = await publishPendingSlackNotifications({
    store,
    client,
    workerId: "publisher-1",
    now: () => baseNow,
    retryAfterMs: 1_000
  });
  const firstError = store.getSlackNotification(notification.id)?.error ?? "";
  const immediateRetry = await publishPendingSlackNotifications({
    store,
    client,
    workerId: "publisher-1",
    now: () => baseNow,
    retryAfterMs: 1_000
  });
  const retried = await publishPendingSlackNotifications({
    store,
    client,
    workerId: "publisher-1",
    now: () => new Date("2026-04-13T00:00:01.000Z"),
    retryAfterMs: 1_000
  });

  assert.deepEqual(failed, { sent: 0, failed: 1, claimed: 1 });
  assert.doesNotMatch(firstError, /xoxb-1234567890-secret/);
  assert.doesNotMatch(firstError, /ghp_sensitive123/);
  assert.doesNotMatch(firstError, /sk-sensitive123/);
  assert.match(firstError, /\[redacted-slack-token\]/);
  assert.match(firstError, /\[redacted-github-token\]/);
  assert.match(firstError, /\[redacted-token\]/);
  assert.deepEqual(immediateRetry, { sent: 0, failed: 0, claimed: 0 });
  assert.deepEqual(retried, { sent: 1, failed: 0, claimed: 1 });
  assert.equal(attempts, 2);
  assert.equal(store.getSlackNotification(notification.id)?.status, "sent");
  assert.doesNotMatch(store.getSlackNotification(notification.id)?.error ?? "", /xoxb-1234567890-secret/);
  assert.doesNotMatch(store.getSlackNotification(notification.id)?.error ?? "", /ghp_sensitive123/);
  assert.doesNotMatch(store.getSlackNotification(notification.id)?.error ?? "", /sk-sensitive123/);
});

test("Slack task cards escape mrkdwn-controlled content from runner output", () => {
  const failureText = blockText(
    failureBlocks({
      title: "Failure <!channel>",
      error: "Bad output for <@U123> & `formatting`"
    })
  );

  assert.match(failureText, /Failure &lt;!channel&gt;/);
  assert.match(failureText, /&lt;@U123&gt; &amp; `formatting`/);
  assert.doesNotMatch(failureText, /<!channel>/);
  assert.doesNotMatch(failureText, /<@U123>/);

  const completionText = blockText(
    completionBlocks({
      session: sampleSession({
        branchName: "codex/slack/branch`<@U123>",
        draftPullRequest: {
          title: "Codex: test",
          body: "body",
          branchName: "codex/slack/branch`<@U123>",
          commitSha: "abc123",
          prUrl: "https://github.com/example/repo/pull/1?<@U123>",
          changedFiles: ["src/weird`<@U123>&.ts"],
          createdAt: "2026-04-13T00:00:00.000Z",
          createdBySlackUserId: "U1"
        }
      }),
      summary: "Implemented <@U123> & <!channel>",
      diff: {
        changedFiles: ["src/weird`<@U123>&.ts"],
        diffStat: "src/<@U123>.ts | 1 +"
      }
    })
  );

  assert.match(completionText, /Implemented &lt;@U123&gt; &amp; &lt;!channel&gt;/);
  assert.match(completionText, /codex\/slack\/branch'&lt;@U123&gt;/);
  assert.match(completionText, /src\/weird'&lt;@U123&gt;&amp;\.ts/);
  assert.match(completionText, /src\/&lt;@U123&gt;\.ts \| 1 \+/);
  assert.doesNotMatch(completionText, /<@U123>/);
  assert.doesNotMatch(completionText, /<!channel>/);

  const kickoffText = blockText(
    kickoffBlocks({
      repoId: "repo`<@U123>",
      branchName: "branch`<!channel>",
      status: "Inspecting <@U123>"
    })
  );
  assert.match(kickoffText, /repo'&lt;@U123&gt;/);
  assert.match(kickoffText, /branch'&lt;!channel&gt;/);
  assert.match(kickoffText, /Inspecting &lt;@U123&gt;/);
  assert.doesNotMatch(kickoffText, /<@U123>/);
  assert.doesNotMatch(kickoffText, /<!channel>/);
});

test("Slack notification publisher marks malformed thread notifications failed", async () => {
  const store = new InMemoryStore();
  const notification = enqueueSlackNotification(store, {
    kind: "runner.started",
    severity: "info",
    slackThreadKey: "invalid" as `${string}:${string}:${string}`,
    sessionId: "session-1",
    repoId: "default",
    taskRunId: "run-1",
    queueJobId: "job-1",
    title: "Queued task running",
    detail: "Mode: implement",
    now: baseNow,
    maxAttempts: 1
  });

  const result = await publishPendingSlackNotifications({
    store,
    client: {
      chat: {
        postMessage: async () => {
          throw new Error("should not post");
        }
      }
    },
    workerId: "publisher-1",
    now: () => baseNow
  });

  assert.deepEqual(result, { sent: 0, failed: 1, claimed: 1 });
  assert.equal(store.getSlackNotification(notification.id)?.status, "failed");
  assert.match(store.getSlackNotification(notification.id)?.error ?? "", /Invalid Slack thread key/);
});

function sampleApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "approval-1",
    taskRunId: "run-1",
    sessionId: "session-1",
    requestedBySlackUserId: "U1",
    type: "execute_plan",
    summary: "Plan: edit README",
    expiresAt: "2026-04-14T00:00:00.000Z",
    status: "pending",
    createdAt: "2026-04-13T00:00:00.000Z",
    ...overrides
  };
}

function sampleSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    slackThreadKey: "T1:C1:1000.1",
    ownerSlackUserId: "U1",
    repoId: "default",
    sourceRepoPath: "/tmp/repo",
    workspacePath: "/tmp/worktree",
    branchName: "codex/slack/session-1",
    runnerKind: "exec",
    status: "done",
    createdAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
    ...overrides
  };
}

function blockText(blocks: unknown[]): string {
  const text: string[] = [];
  collectTextFields(blocks, text);
  return text.join("\n");
}

function collectTextFields(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFields(item, output);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === "string") {
    output.push(record.text);
  }

  for (const [key, child] of Object.entries(record)) {
    if (key !== "url") {
      collectTextFields(child, output);
    }
  }
}
