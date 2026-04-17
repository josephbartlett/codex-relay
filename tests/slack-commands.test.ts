import assert from "node:assert/strict";
import test from "node:test";
import { registerCommandListeners } from "../apps/slack-gateway/src/listeners/commands.js";

test("slash command new opens the task modal", async () => {
  const openedViews: unknown[] = [];
  let acked = false;
  const orchestrator = {
    authorizeSlackInteraction: () => undefined,
    listSessions: () => []
  };
  const handler = registerSlashCommandHandler(orchestrator);

  await handler({
    command: {
      text: "new",
      user_id: "U1",
      channel_id: "C1",
      team_id: "T1",
      trigger_id: "trigger-1"
    },
    ack: async () => {
      acked = true;
    },
    client: {
      views: {
        open: async (input: unknown) => {
          openedViews.push(input);
        }
      }
    },
    respond: async () => {
      throw new Error("Expected /codex new to open a modal, not send a response.");
    }
  });

  assert.equal(acked, true);
  assert.equal(openedViews.length, 1);
  assert.match(JSON.stringify(openedViews[0]), /trigger-1/);
  assert.match(JSON.stringify(openedViews[0]), /New Codex Task/);
});

test("slash command status returns visible sessions", async () => {
  const responses: unknown[] = [];
  const orchestrator = {
    authorizeSlackInteraction: () => undefined,
    listSessions: () => [
      {
        ownerSlackUserId: "U1",
        status: "done",
        repoId: "default",
        branchName: "codex/slack/example"
      },
      {
        ownerSlackUserId: "U2",
        status: "running",
        repoId: "private",
        branchName: "codex/slack/other"
      }
    ]
  };
  const handler = registerSlashCommandHandler(orchestrator);

  await handler({
    command: {
      text: "status",
      user_id: "U1",
      channel_id: "C1",
      team_id: "T1",
      trigger_id: "trigger-1"
    },
    ack: async () => undefined,
    client: {},
    respond: async (input: unknown) => {
      responses.push(input);
    }
  });

  assert.equal(responses.length, 1);
  const response = JSON.stringify(responses[0]);
  assert.match(response, /ephemeral/);
  assert.match(response, /done repo:default branch:codex\/slack\/example/);
  assert.doesNotMatch(response, /private/);
});

test("slash command fallback lists supported commands", async () => {
  const responses: unknown[] = [];
  const orchestrator = {
    authorizeSlackInteraction: () => undefined,
    listSessions: () => []
  };
  const handler = registerSlashCommandHandler(orchestrator);

  await handler({
    command: {
      text: "unknown",
      user_id: "U1",
      channel_id: "C1",
      team_id: "T1",
      trigger_id: "trigger-1"
    },
    ack: async () => undefined,
    client: {},
    respond: async (input: unknown) => {
      responses.push(input);
    }
  });

  assert.equal(responses.length, 1);
  const response = JSON.stringify(responses[0]);
  assert.match(response, /\/codex new/);
  assert.match(response, /\/codex status/);
  assert.match(response, /\/codex audit/);
  assert.match(response, /\/codex cleanup/);
});

function registerSlashCommandHandler(orchestrator: unknown): (input: any) => Promise<void> {
  let handler: ((input: any) => Promise<void>) | undefined;
  const app = {
    command: (name: string, registered: (input: any) => Promise<void>) => {
      assert.equal(name, "/codex");
      handler = registered;
    },
    view: () => undefined
  };

  registerCommandListeners(
    app as any,
    orchestrator as any,
    {
      defaultRepoId: "default"
    } as any
  );

  assert.ok(handler);
  return handler;
}
