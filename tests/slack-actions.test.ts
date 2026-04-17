import assert from "node:assert/strict";
import test from "node:test";
import { registerActionListeners } from "../apps/slack-gateway/src/listeners/actions.js";
import { SlackActionIds } from "../packages/shared/src/events.js";

test("App Home approval refreshes the source thread approval card", async () => {
  const approval = {
    id: "approval-1",
    sessionId: "session-1",
    taskRunId: "run-1",
    type: "execute_plan",
    status: "pending",
    summary: "Plan summary",
    requestedBySlackUserId: "U1",
    expiresAt: "2026-04-17T20:00:00.000Z"
  };
  const session = {
    id: "session-1",
    slackThreadKey: "T1:C1:1000.1",
    ownerSlackUserId: "U1",
    repoId: "default",
    branchName: "codex/slack/example",
    workspacePath: "/tmp/worktree",
    workspaceKind: "worktree",
    status: "awaiting_approval"
  };
  const chatUpdates: unknown[] = [];
  const viewPublishes: unknown[] = [];
  const posts: unknown[] = [];
  const handler = registerActionHandler({
    expireApprovalIfNeeded: () => approval,
    getApproval: () => approval,
    getSession: () => session,
    authorizeSlackInteraction: () => undefined,
    listSessions: () => [session],
    listPendingApprovalsForUser: () => [],
    listAuditEventsForSlackUser: () => [],
    approveAndExecute: async () => {
      approval.status = "approved";
      return {
        implementRun: { mode: "implement" },
        runnerResult: { status: "completed", finalMessage: "Done" },
        diff: { changedFiles: [], diffStat: "" }
      };
    }
  });

  await handler({
    body: {
      user: { id: "U1" },
      view: { id: "home-view" },
      container: { type: "view" }
    },
    action: { value: "approval-1" },
    ack: async () => undefined,
    respond: async () => undefined,
    logger: { error: () => undefined, warn: () => undefined },
    client: {
      conversations: {
        replies: async () => ({
          ok: true,
          messages: [
            {
              ts: "1001.1",
              blocks: [
                {
                  type: "actions",
                  elements: [
                    {
                      action_id: SlackActionIds.approveExecution,
                      value: "approval-1"
                    }
                  ]
                }
              ]
            }
          ]
        })
      },
      chat: {
        update: async (input: unknown) => {
          chatUpdates.push(input);
        },
        postMessage: async (input: unknown) => {
          posts.push(input);
        }
      },
      views: {
        publish: async (input: unknown) => {
          viewPublishes.push(input);
        }
      }
    }
  });

  assert.equal(chatUpdates.length, 1);
  assert.match(JSON.stringify(chatUpdates[0]), /"channel":"C1"/);
  assert.match(JSON.stringify(chatUpdates[0]), /"ts":"1001.1"/);
  assert.match(JSON.stringify(chatUpdates[0]), /Execution approved/);
  assert.doesNotMatch(JSON.stringify(chatUpdates[0]), /approve_execution/);
  assert.equal(viewPublishes.length, 1);
  assert.equal(posts.length, 2);
});

function registerActionHandler(orchestrator: unknown): (input: any) => Promise<void> {
  let handler: ((input: any) => Promise<void>) | undefined;
  const app = {
    action: (name: string, registered: (input: any) => Promise<void>) => {
      if (name === SlackActionIds.approveExecution) {
        handler = registered;
      }
    }
  };

  registerActionListeners(app as any, orchestrator as any, {} as any);

  assert.ok(handler);
  return handler;
}
