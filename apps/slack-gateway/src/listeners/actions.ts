import type { App } from "@slack/bolt";
import type { HarnessConfig } from "../../../../packages/shared/src/config.js";
import type { Session } from "../../../../packages/shared/src/types.js";
import { SlackActionIds } from "../../../../packages/shared/src/events.js";
import type { Orchestrator } from "../../../orchestrator/src/tasks.js";
import {
  completionBlocks,
  failureBlocks,
  prLifecycleBlocks,
  progressBlocks,
  prReadyBlocks,
  prStatusBlocks
} from "../blocks/taskCards.js";
import { diffSummaryModal } from "../modals/diffSummaryModal.js";

export function registerActionListeners(app: App, orchestrator: Orchestrator, config: HarnessConfig): void {
  app.action(SlackActionIds.approveExecution, async ({ ack, body, action, client, logger }: any) => {
    await ack();

    const approvalId = action.value as string;
    const userId = body.user?.id;
    const approval = orchestrator.getApproval(approvalId);
    const session = approval ? orchestrator.getSession(approval.sessionId) : undefined;
    const slackThread = session ? parseSessionThread(session) : undefined;
    const channel = slackThread?.channelId ?? body.channel?.id;
    const threadTs = slackThread?.threadTs ?? body.message?.thread_ts ?? body.message?.ts;

    if (!channel || !threadTs || !userId) {
      logger.error("Missing Slack channel, thread, or user on approval action.");
      return;
    }

    if (session) {
      try {
        orchestrator.authorizeSlackInteraction({
          action: "approve_execution",
          slackUserId: userId,
          slackChannelId: channel,
          repoId: session.repoId
        });
      } catch (error) {
        await client.chat.postEphemeral({
          channel,
          user: userId,
          text: error instanceof Error ? error.message : String(error)
        });
        return;
      }
    }

    let progressPosted = false;
    const postApprovalProgress = async () => {
      if (progressPosted) {
        return;
      }

      progressPosted = true;
      const approvalAfterStart = orchestrator.getApproval(approvalId);
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `Codex ${approvalAfterStart?.type === "run_tests" ? "test run" : "execution"} approved.`,
        blocks: progressBlocks({
          title: approvalAfterStart?.type === "run_tests" ? "Test run approved" : "Execution approved",
          detail:
            approvalAfterStart?.type === "run_tests"
              ? "Running the approved checks in the isolated worktree."
              : "Running implementation in the isolated worktree."
        })
      });
    };

    void orchestrator
      .approveAndExecute(approvalId, userId, async () => {
        await postApprovalProgress();
      })
      .then(async ({ implementRun, runnerResult, diff }) => {
        const approvalAfterRun = orchestrator.getApproval(approvalId);
        const sessionAfterRun = approvalAfterRun ? orchestrator.getSession(approvalAfterRun.sessionId) : undefined;

        if (!sessionAfterRun) {
          throw new Error("Session not found after execution.");
        }

        if (runnerResult.status !== "completed") {
          await client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: approval?.type === "run_tests" ? "Codex test run did not complete." : "Codex execution did not complete.",
            blocks: failureBlocks({
              title:
                runnerResult.status === "cancelled"
                  ? approval?.type === "run_tests"
                    ? "Test run cancelled"
                    : "Execution cancelled"
                  : approval?.type === "run_tests"
                    ? "Test run failed"
                    : "Execution failed",
              error: runnerResult.finalMessage
            })
          });
          return;
        }

        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: approval?.type === "run_tests" ? "Codex test run completed." : "Codex execution completed.",
          blocks: completionBlocks({
            session: sessionAfterRun,
            summary: runnerResult.finalMessage,
            diff,
            mode: implementRun.mode === "test" ? "test" : "implement"
          })
        });
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(message);
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: "Codex execution failed.",
          blocks: failureBlocks({ title: "Execution failed", error: message })
        });
      });
  });

  app.action(SlackActionIds.cancelTask, async ({ ack, body, client, respond, logger }: any) => {
    await ack();

    const teamId = body.team?.id ?? "";
    const channel = body.channel?.id;
    const threadTs = body.message?.thread_ts ?? body.message?.ts;
    const userId = body.user?.id;

    if (!channel || !threadTs || !userId) {
      await respond({ response_type: "ephemeral", text: "Could not identify the task to cancel." });
      return;
    }

    try {
      const session = orchestrator.getSessionBySlackThread({ teamId, channelId: channel, threadTs });

      if (session) {
        orchestrator.authorizeSlackInteraction({
          action: "cancel_task",
          slackUserId: userId,
          slackChannelId: channel,
          repoId: session.repoId
        });
      }

      const result = await orchestrator.cancelSessionBySlackThread({
        teamId,
        channelId: channel,
        threadTs,
        requestingUserId: userId
      });
      const detail =
        result.cancelledRunIds.length > 0
          ? `Cancelled ${result.cancelledRunIds.length} active run(s).`
          : "No active run was currently executing; pending approvals were rejected.";

      await respond({ response_type: "ephemeral", text: detail });
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "Codex task cancelled.",
        blocks: progressBlocks({
          title: "Task cancelled",
          detail
        })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      await respond({ response_type: "ephemeral", text: message });
    }
  });

  app.action(SlackActionIds.revisePlan, async ({ ack, respond }: any) => {
    await ack();
    await respond({
      response_type: "ephemeral",
      text: "Reply in this thread with the requested plan changes and mention the bot again."
    });
  });

  app.action(SlackActionIds.openDetails, async ({ ack, body, action, client, respond, logger }: any) => {
    await ack();

    const explicitSessionId = action.value && action.value !== "details" ? String(action.value) : undefined;
    const teamId = body.team?.id ?? "";
    const channel = body.channel?.id;
    const threadTs = body.message?.thread_ts ?? body.message?.ts;
    const session =
      explicitSessionId && orchestrator.getSession(explicitSessionId)
        ? orchestrator.getSession(explicitSessionId)
        : channel && threadTs
          ? orchestrator.getSessionBySlackThread({ teamId, channelId: channel, threadTs })
          : undefined;

    if (!session) {
      await respond({ response_type: "ephemeral", text: "No Codex session was found for this Slack thread." });
      return;
    }

    const userId = body.user?.id;

    if (!userId) {
      await respond({ response_type: "ephemeral", text: "Could not identify the requesting Slack user." });
      return;
    }

    try {
      const diff = await orchestrator.collectSessionDiffSummaryForSlackUser({
        sessionId: session.id,
        requestingUserId: userId,
        slackChannelId: channel
      });
      await client.views.open({
        trigger_id: body.trigger_id,
        view: diffSummaryModal({ session, diff })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      await respond({ response_type: "ephemeral", text: message });
    }
  });

  app.action(SlackActionIds.createPr, async ({ ack, body, action, client, respond, logger }: any) => {
    await ack();

    const sessionId = action.value as string;
    const channel = body.channel?.id;
    const threadTs = body.message?.thread_ts ?? body.message?.ts;
    const userId = body.user?.id;

    if (!sessionId || !channel || !threadTs || !userId) {
      await respond({ response_type: "ephemeral", text: "Could not identify the session for PR creation." });
      return;
    }

    try {
      const session = orchestrator.getSession(sessionId);

      if (session) {
        orchestrator.authorizeSlackInteraction({
          action: "create_pr",
          slackUserId: userId,
          slackChannelId: channel,
          repoId: session.repoId
        });
      }

      await respond({
        response_type: "ephemeral",
        text: session?.draftPullRequest
          ? "Updating the existing draft PR from the session worktree branch."
          : "Creating a draft PR from the session worktree branch."
      });
      const lifecycle = await orchestrator.createDraftPullRequest({
        sessionId,
        requestingUserId: userId,
        slackChannelId: channel
      });
      const actionText =
        lifecycle.operation === "created"
          ? "Draft PR created"
          : lifecycle.operation === "updated"
            ? "Draft PR updated"
            : "Draft PR already current";
      const sessionAfterPr = orchestrator.getSession(sessionId);

      if (!sessionAfterPr) {
        throw new Error("Session was not found after PR handoff.");
      }

      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `${actionText}: ${lifecycle.result.prUrl}`,
        blocks: prLifecycleBlocks({
          lifecycle,
          session: sessionAfterPr
        })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      await respond({ response_type: "ephemeral", text: message });
    }
  });

  app.action(SlackActionIds.checkPrStatus, async ({ ack, body, action, client, respond, logger }: any) => {
    await ack();

    const sessionId = action.value as string;
    const channel = body.channel?.id;
    const threadTs = body.message?.thread_ts ?? body.message?.ts;
    const userId = body.user?.id;

    if (!sessionId || !channel || !threadTs || !userId) {
      await respond({ response_type: "ephemeral", text: "Could not identify the session for PR status." });
      return;
    }

    try {
      const status = await orchestrator.getDraftPullRequestStatusForSlackUser({
        sessionId,
        requestingUserId: userId,
        slackChannelId: channel
      });

      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `Draft PR status: ${status.checksSummary}`,
        blocks: prStatusBlocks({ status, session: orchestrator.getSession(sessionId) })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      await respond({ response_type: "ephemeral", text: message });
    }
  });

  app.action(SlackActionIds.markPrReady, async ({ ack, body, action, client, respond, logger }: any) => {
    await ack();

    const sessionId = action.value as string;
    const channel = body.channel?.id;
    const threadTs = body.message?.thread_ts ?? body.message?.ts;
    const userId = body.user?.id;

    if (!sessionId || !channel || !threadTs || !userId) {
      await respond({ response_type: "ephemeral", text: "Could not identify the session for ready-for-review." });
      return;
    }

    try {
      const ready = await orchestrator.markDraftPullRequestReadyForReview({
        sessionId,
        requestingUserId: userId,
        slackChannelId: channel
      });
      const session = orchestrator.getSession(sessionId);

      if (!session) {
        throw new Error("Session was not found after marking PR ready.");
      }

      if (ready.operation === "already_ready") {
        await respond({
          response_type: "ephemeral",
          text: `PR is already ready for review: ${ready.prUrl}`
        });
        return;
      }

      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `PR marked ready for review: ${ready.prUrl}`,
        blocks: prReadyBlocks({ ready, session })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      await respond({ response_type: "ephemeral", text: message });
    }
  });
}

function parseSessionThread(session: Session): { teamId: string; channelId: string; threadTs: string } {
  const [teamId, channelId, threadTs] = session.slackThreadKey.split(":");

  if (!teamId || !channelId || !threadTs) {
    throw new Error(`Invalid Slack thread key: ${session.slackThreadKey}`);
  }

  return { teamId, channelId, threadTs };
}
