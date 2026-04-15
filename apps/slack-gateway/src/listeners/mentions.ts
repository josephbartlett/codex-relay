import type { App } from "@slack/bolt";
import type { Orchestrator } from "../../../orchestrator/src/tasks.js";
import { resolveRepoBinding, type HarnessConfig } from "../../../../packages/shared/src/config.js";
import {
  diffSummaryBlocks,
  failureBlocks,
  guidanceBlocks,
  answerBlocks,
  completionBlocks,
  kickoffBlocks,
  planBlocks,
  prLifecycleBlocks,
  prReadyBlocks,
  progressBlocks
} from "../blocks/taskCards.js";
import {
  buildSlackTaskContext,
  classifyFollowUpIntent,
  extractRepoId,
  stripBotMention
} from "../../../orchestrator/src/context.js";

export function registerMentionListeners(app: App, orchestrator: Orchestrator, config: HarnessConfig): void {
  app.event("app_mention", async ({ event, client, logger }) => {
    const threadTs = event.thread_ts ?? event.ts;
    const teamId = event.team ?? "";
    const userId = event.user;
    const text = stripBotMention(event.text ?? "");

    if (!userId) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: "Codex could not identify the requesting Slack user."
      });
      return;
    }

    if (!text) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: "Tell me what repo task to inspect or implement."
      });
      return;
    }

    try {
      const existingSession = orchestrator.getSessionBySlackThread({ teamId, channelId: event.channel, threadTs });
      const intent = classifyFollowUpIntent({ text, hasExistingSession: Boolean(existingSession) });
      const slack = buildSlackTaskContext({
        teamId,
        channelId: event.channel,
        threadTs,
        requestingUserId: userId,
        text
      });
      const startsPlan =
        intent === "new_task" || (Boolean(existingSession) && ["continue", "revise_plan", "run_tests"].includes(intent));
      const startsAsk = intent === "ask";
      const startsDirect = intent === "direct";

      if (startsPlan || startsAsk || startsDirect) {
        const repo = existingSession
          ? resolveRepoBinding(config, existingSession.repoId)
          : resolveRepoBinding(config, extractRepoId(text));

        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: existingSession ? "Codex follow-up received." : "Codex task started.",
          blocks: kickoffBlocks({
            repoId: repo.id,
            branchName:
              startsAsk || startsDirect
                ? "source workspace"
                : existingSession?.branchName ?? "creating worktree",
            mode: startsAsk ? "ask" : startsDirect ? "direct" : intent === "run_tests" ? "test-plan" : "plan",
            status: startsAsk ? "Answering read-only question" : startsDirect ? "Editing source workspace" : intent === "run_tests" ? "Planning test run" : "Inspecting repo"
          })
        });
      }

      void orchestrator
        .handleFollowUpFromSlack(slack, async (runnerEvent) => {
          if (runnerEvent.type === "stderr") {
            logger.warn(runnerEvent.message ?? "Codex stderr");
          }
        })
        .then(async (result) => {
          if (result.kind === "ask") {
            await client.chat.postMessage({
              channel: event.channel,
              thread_ts: threadTs,
              text: "Codex answer ready.",
              blocks: answerBlocks({ session: result.session, answer: result.runnerResult.finalMessage })
            });
            return;
          }

          if (result.kind === "direct") {
            await client.chat.postMessage({
              channel: event.channel,
              thread_ts: threadTs,
              text: "Codex direct workspace task completed.",
              blocks: completionBlocks({
                session: result.session,
                summary: result.runnerResult.finalMessage,
                diff: result.diff
              })
            });
            return;
          }

          if (result.kind === "plan") {
            await client.chat.postMessage({
              channel: event.channel,
              thread_ts: threadTs,
              text: result.intent === "run_tests" ? "Codex test plan ready." : "Codex plan ready.",
              blocks: planBlocks(result.approval)
            });
            return;
          }

          if (result.kind === "diff") {
            await client.chat.postMessage({
              channel: event.channel,
              thread_ts: threadTs,
              text: "Codex diff summary.",
              blocks: diffSummaryBlocks({ session: result.session, diff: result.diff })
            });
            return;
          }

          if (result.kind === "cancel") {
            const detail =
              result.cancelledRunIds.length > 0
                ? `Cancelled ${result.cancelledRunIds.length} active run(s).`
                : "No active run was currently executing; pending approvals were rejected.";

            await client.chat.postMessage({
              channel: event.channel,
              thread_ts: threadTs,
              text: "Codex task cancelled.",
              blocks: progressBlocks({ title: "Task cancelled", detail })
            });
            return;
          }

          if (result.kind === "pull_request") {
            const actionText =
              result.lifecycle.operation === "created"
                ? "Draft PR created"
                : result.lifecycle.operation === "updated"
                  ? "Draft PR updated"
                  : "Draft PR already current";

            await client.chat.postMessage({
              channel: event.channel,
              thread_ts: threadTs,
              text: `${actionText}: ${result.lifecycle.result.prUrl}`,
              blocks: prLifecycleBlocks({ lifecycle: result.lifecycle, session: result.session })
            });
            return;
          }

          if (result.kind === "pr_ready") {
            await client.chat.postMessage({
              channel: event.channel,
              thread_ts: threadTs,
              text:
                result.ready.operation === "ready"
                  ? `PR marked ready for review: ${result.ready.prUrl}`
                  : `PR already ready for review: ${result.ready.prUrl}`,
              blocks: prReadyBlocks({ ready: result.ready, session: result.session })
            });
            return;
          }

          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: threadTs,
            text: result.message,
            blocks: guidanceBlocks({ title: "Codex follow-up", detail: result.message })
          });
        })
        .catch(async (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(message);
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: threadTs,
            text: "Codex planning failed.",
            blocks: failureBlocks({ title: "Planning failed", error: message })
          });
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: "Codex could not start.",
        blocks: failureBlocks({ title: "Could not start task", error: message })
      });
    }
  });
}
