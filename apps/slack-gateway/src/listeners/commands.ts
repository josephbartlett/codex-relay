import type { App } from "@slack/bolt";
import { resolveRepoBinding, type HarnessConfig } from "../../../../packages/shared/src/config.js";
import type { AuditEvent } from "../../../../packages/shared/src/types.js";
import { buildSlackTaskContext, extractRepoId } from "../../../orchestrator/src/context.js";
import type { Orchestrator } from "../../../orchestrator/src/tasks.js";
import { failureBlocks, kickoffBlocks, planBlocks, progressBlocks } from "../blocks/taskCards.js";
import { newTaskModal, newTaskModalCallbackId } from "../modals/newTaskModal.js";

interface NewTaskMetadata {
  channelId: string;
  teamId: string;
}

export function registerCommandListeners(app: App, orchestrator: Orchestrator, config: HarnessConfig): void {
  app.command("/codex", async ({ command, ack, client, respond }) => {
    await ack();

    const [subcommand] = command.text.trim().split(/\s+/);

    if (subcommand === "new") {
      try {
        orchestrator.authorizeSlackInteraction({
          action: "start_task",
          slackUserId: command.user_id,
          slackChannelId: command.channel_id
        });
      } catch (error) {
        await respond({
          response_type: "ephemeral",
          text: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      await client.views.open({
        trigger_id: command.trigger_id,
        view: newTaskModal({
          defaultRepoId: config.defaultRepoId,
          channelId: command.channel_id,
          teamId: command.team_id
        })
      });
      return;
    }

    if (subcommand === "cleanup") {
      try {
        orchestrator.authorizeSlackInteraction({
          action: "cleanup",
          slackUserId: command.user_id,
          slackChannelId: command.channel_id
        });
      } catch (error) {
        await respond({
          response_type: "ephemeral",
          text: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      const cleanup = await orchestrator.cleanupWorktrees({
        requestingUserId: command.user_id,
        slackChannelId: command.channel_id,
        olderThanDays: parseOlderThanDays(command.text),
        dryRun: !command.text.includes("--confirm")
      });
      await respond({
        response_type: "ephemeral",
        text: formatCleanupResult(cleanup)
      });
      return;
    }

    if (subcommand === "handoff") {
      const repoId = extractRepoId(command.text) ?? config.defaultRepoId;

      try {
        const repo = resolveRepoBinding(config, repoId);
        orchestrator.authorizeSlackInteraction({
          action: "start_task",
          slackUserId: command.user_id,
          slackChannelId: command.channel_id,
          repoId: repo.id
        });
        const kickoff = await client.chat.postMessage({
          channel: command.channel_id,
          text: "Codex local handoff thread ready.",
          blocks: progressBlocks({
            title: "Local handoff ready",
            detail: `Repo: ${repo.id}\nStart a Relay local session from your machine, then continue in this thread from Slack.`
          })
        });

        if (!kickoff.ts) {
          throw new Error("Slack did not return a timestamp for the handoff message.");
        }

        await respond({
          response_type: "ephemeral",
          text: [
            "Run this from the Codex Relay repo on your machine:",
            "",
            `npm run local:session -- --thread-key ${command.team_id}:${command.channel_id}:${kickoff.ts} --user ${command.user_id} --repo ${repo.id} --mode implement --prompt "describe the local task"`
          ].join("\n")
        });
      } catch (error) {
        await respond({
          response_type: "ephemeral",
          text: error instanceof Error ? error.message : String(error)
        });
      }

      return;
    }

    if (subcommand === "status") {
      try {
        orchestrator.authorizeSlackInteraction({
          action: "status",
          slackUserId: command.user_id,
          slackChannelId: command.channel_id
        });
      } catch (error) {
        await respond({
          response_type: "ephemeral",
          text: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      const sessions = orchestrator
        .listSessions()
        .filter((session) => session.ownerSlackUserId === command.user_id)
        .slice(0, 8);
      const text =
        sessions.length === 0
          ? "No Codex tasks for your Slack user."
          : sessions
              .map((session) => `- ${session.status} repo:${session.repoId} branch:${session.branchName}`)
              .join("\n");

      await respond({ response_type: "ephemeral", text });
      return;
    }

    if (subcommand === "audit") {
      try {
        orchestrator.authorizeSlackInteraction({
          action: "audit",
          slackUserId: command.user_id,
          slackChannelId: command.channel_id
        });
      } catch (error) {
        await respond({
          response_type: "ephemeral",
          text: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      const limit = parseLimit(command.text, 12);
      const events = orchestrator.listAuditEventsForSlackUser(command.user_id, limit);
      await respond({
        response_type: "ephemeral",
        text: formatAuditEvents(events)
      });
      return;
    }

    await respond({
      response_type: "ephemeral",
      text: "Use `/codex new`, `/codex handoff`, `/codex status`, `/codex audit`, `/codex cleanup`, or mention the bot in a thread to start a task."
    });
  });

  app.view(newTaskModalCallbackId, async ({ ack, body, view, client, logger }: any) => {
    await ack();

    let metadata: NewTaskMetadata;

    try {
      metadata = JSON.parse(view.private_metadata) as NewTaskMetadata;
    } catch {
      logger.error("Invalid /codex new private_metadata.");
      return;
    }

    const repoId = readPlainTextInput(view, "repo", "id") || config.defaultRepoId;
    const taskText = readPlainTextInput(view, "task", "text");
    const requestingUserId = body.user?.id;

    if (!requestingUserId || !metadata.channelId || !taskText) {
      logger.error("Missing required /codex new fields.");
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
      const kickoff = await client.chat.postMessage({
        channel: metadata.channelId,
        text: "Codex task started.",
        blocks: kickoffBlocks({
          repoId: repo.id,
          branchName: "creating worktree",
          status: "Inspecting repo"
        })
      });
      const threadTs = kickoff.ts;

      if (!threadTs) {
        throw new Error("Slack did not return a timestamp for the kickoff message.");
      }

      const slack = buildSlackTaskContext({
        teamId: metadata.teamId,
        channelId: metadata.channelId,
        threadTs,
        requestingUserId,
        text: `repo:${repo.id} ${taskText}`
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
            thread_ts: threadTs,
            text: "Codex plan ready.",
            blocks: planBlocks(approval)
          });
        })
        .catch(async (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(message);
          await client.chat.postMessage({
            channel: metadata.channelId,
            thread_ts: threadTs,
            text: "Codex planning failed.",
            blocks: failureBlocks({ title: "Planning failed", error: message })
          });
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      await client.chat.postMessage({
        channel: metadata.channelId,
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

function parseOlderThanDays(text: string): number {
  const match = text.match(/--older-than-days=(\d+)/);
  const parsed = match ? Number.parseInt(match[1] ?? "", 10) : 7;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 7;
}

function parseLimit(text: string, fallback: number): number {
  const match = text.match(/--limit=(\d+)/);
  const parsed = match ? Number.parseInt(match[1] ?? "", 10) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : fallback;
}

function formatCleanupResult(result: Awaited<ReturnType<Orchestrator["cleanupWorktrees"]>>): string {
  const action = result.dryRun ? "would remove" : "removed";
  const actionCount = result.dryRun
    ? result.skipped.filter((item) => item.reason === "dry run").length
    : result.removed.length;
  const lines = [
    `Cleanup ${result.dryRun ? "dry run" : "complete"}.`,
    `Inspected: ${result.inspected}`,
    `${capitalize(action)}: ${actionCount}`
  ];

  if (result.skipped.length > 0) {
    lines.push("Skipped:");
    lines.push(
      ...result.skipped
        .slice(0, 10)
        .map((item) => `- ${item.sessionId}: ${item.reason} (${item.workspacePath})`)
    );
  }

  if (result.dryRun) {
    lines.push("Run `/codex cleanup --confirm` to remove the listed worktrees.");
  }

  return lines.join("\n");
}

function formatAuditEvents(events: AuditEvent[]): string {
  if (events.length === 0) {
    return "No audit events visible to your Slack user.";
  }

  return [
    "Recent Codex Relay audit events:",
    ...events.map((event) => {
      const repo = event.repoId ? ` repo:${event.repoId}` : "";
      const session = event.sessionId ? ` session:${event.sessionId}` : "";
      return `- ${event.at} ${event.outcome} ${event.type}${repo}${session} - ${event.summary}`;
    })
  ].join("\n");
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
