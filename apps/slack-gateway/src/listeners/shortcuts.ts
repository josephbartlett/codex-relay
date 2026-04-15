import type { App } from "@slack/bolt";
import { resolveRepoBinding, type HarnessConfig } from "../../../../packages/shared/src/config.js";
import { SlackShortcutIds, SlackViewCallbackIds } from "../../../../packages/shared/src/events.js";
import { buildSlackTaskContext } from "../../../orchestrator/src/context.js";
import type { Orchestrator } from "../../../orchestrator/src/tasks.js";
import { failureBlocks, kickoffBlocks, planBlocks } from "../blocks/taskCards.js";

interface ShortcutMetadata {
  teamId: string;
  channelId: string;
  messageTs: string;
  threadTs: string;
  selectedMessageText?: string;
}

export function registerShortcutListeners(app: App, orchestrator: Orchestrator, config: HarnessConfig): void {
  app.shortcut(SlackShortcutIds.runWithCodex, async ({ shortcut, ack, client }: any) => {
    await ack();

    const selectedMessageText = shortcut.message?.text ? truncateForMetadata(shortcut.message.text) : undefined;
    const threadTs = shortcut.message?.thread_ts ?? shortcut.message?.ts;
    const requestingUserId = shortcut.user?.id;

    if (requestingUserId) {
      try {
        orchestrator.authorizeSlackInteraction({
          action: "start_task",
          slackUserId: requestingUserId,
          slackChannelId: shortcut.channel.id
        });
      } catch (error) {
        await client.chat.postEphemeral({
          channel: shortcut.channel.id,
          user: requestingUserId,
          text: error instanceof Error ? error.message : String(error)
        });
        return;
      }
    }

    if (!requestingUserId) {
      return;
    }

    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: {
        type: "modal",
        callback_id: SlackViewCallbackIds.shortcutNewTask,
        title: { type: "plain_text", text: "Run with Codex" },
        submit: { type: "plain_text", text: "Start" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "repo",
            label: { type: "plain_text", text: "Repo id" },
            element: {
              type: "plain_text_input",
              action_id: "id",
              initial_value: config.defaultRepoId
            }
          },
          {
            type: "input",
            block_id: "task",
            label: { type: "plain_text", text: "Task" },
            element: {
              type: "plain_text_input",
              action_id: "text",
              multiline: true,
              initial_value: "Inspect this message and propose a plan."
            }
          }
        ],
        private_metadata: JSON.stringify({
          teamId: shortcut.team?.id ?? "",
          channelId: shortcut.channel.id,
          messageTs: shortcut.message.ts,
          threadTs,
          selectedMessageText
        } satisfies ShortcutMetadata)
      }
    });
  });

  app.view(SlackViewCallbackIds.shortcutNewTask, async ({ ack, body, view, client, logger }: any) => {
    await ack();

    let metadata: ShortcutMetadata;

    try {
      metadata = JSON.parse(view.private_metadata) as ShortcutMetadata;
    } catch {
      logger.error("Invalid shortcut private_metadata.");
      return;
    }

    const repoId = readPlainTextInput(view, "repo", "id") || config.defaultRepoId;
    const taskText = readPlainTextInput(view, "task", "text");
    const requestingUserId = body.user?.id;
    const teamId = metadata.teamId || body.team?.id || "";

    if (!requestingUserId || !metadata.channelId || !metadata.threadTs || !taskText) {
      logger.error("Missing required shortcut task fields.");
      return;
    }

    try {
      const repo = resolveRepoBinding(config, repoId);
      orchestrator.authorizeSlackInteraction({
        action: "start_task",
        slackUserId: requestingUserId,
        slackChannelId: metadata.channelId,
        repoId: repo.id
      });
      const slack = buildSlackTaskContext({
        teamId,
        channelId: metadata.channelId,
        threadTs: metadata.threadTs,
        requestingUserId,
        text: `repo:${repo.id} ${taskText}`,
        selectedMessageText: metadata.selectedMessageText
      });

      await client.chat.postMessage({
        channel: metadata.channelId,
        thread_ts: metadata.threadTs,
        text: "Codex task started from message shortcut.",
        blocks: kickoffBlocks({
          repoId: repo.id,
          branchName: "creating worktree",
          status: "Inspecting selected message and repo"
        })
      });

      void orchestrator
        .startPlanFromSlack(slack, async (runnerEvent) => {
          if (runnerEvent.type === "stderr") {
            logger.warn(runnerEvent.message ?? "Codex stderr");
          }
        })
        .then(async ({ approval }) => {
          await client.chat.postMessage({
            channel: metadata.channelId,
            thread_ts: metadata.threadTs,
            text: "Codex plan ready.",
            blocks: planBlocks(approval)
          });
        })
        .catch(async (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(message);
          await client.chat.postMessage({
            channel: metadata.channelId,
            thread_ts: metadata.threadTs,
            text: "Codex planning failed.",
            blocks: failureBlocks({ title: "Planning failed", error: message })
          });
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      await client.chat.postMessage({
        channel: metadata.channelId,
        thread_ts: metadata.threadTs,
        text: "Codex could not start.",
        blocks: failureBlocks({ title: "Could not start task", error: message })
      });
    }
  });
}

function readPlainTextInput(view: any, blockId: string, actionId: string): string {
  const value = view.state?.values?.[blockId]?.[actionId]?.value;
  return typeof value === "string" ? value.trim() : "";
}

function truncateForMetadata(text: string): string {
  const maxPrivateMetadataBudget = 1800;

  if (text.length <= maxPrivateMetadataBudget) {
    return text;
  }

  return `${text.slice(0, maxPrivateMetadataBudget - 20)}\n... truncated ...`;
}
