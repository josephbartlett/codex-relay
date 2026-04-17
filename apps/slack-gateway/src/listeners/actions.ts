import type { App } from "@slack/bolt";
import type { HarnessConfig } from "../../../../packages/shared/src/config.js";
import type { Session } from "../../../../packages/shared/src/types.js";
import { SlackActionIds } from "../../../../packages/shared/src/events.js";
import type { Orchestrator } from "../../../orchestrator/src/tasks.js";
import {
  approvalAcceptedBlocks,
  completionBlocks,
  failureBlocks,
  prLifecycleBlocks,
  progressBlocks,
  prReadyBlocks,
  prStatusBlocks
} from "../blocks/taskCards.js";
import { diffSummaryModal } from "../modals/diffSummaryModal.js";
import { buildAppHomeView } from "./home.js";

export function registerActionListeners(app: App, orchestrator: Orchestrator, config: HarnessConfig): void {
  app.action(SlackActionIds.approveExecution, async ({ ack, body, action, client, respond, logger }: any) => {
    await ack();

    const approvalId = action.value as string;
    const userId = body.user?.id;
    const approval = orchestrator.expireApprovalIfNeeded(approvalId);

    if (!userId) {
      logger.error("Missing Slack user on approval action.");
      return;
    }

    if (!approval) {
      await sendActionNotice({
        client,
        respond,
        userId,
        channel: body.channel?.id,
        text: "This approval is no longer available. Open App Home or the task thread for the latest state."
      });
      return;
    }

    if (approval.status !== "pending") {
      await sendActionNotice({
        client,
        respond,
        userId,
        channel: body.channel?.id,
        text: approvalStatusGuidance(approval.status)
      });
      return;
    }

    const session = approval ? orchestrator.getSession(approval.sessionId) : undefined;
    const slackThread = session ? parseSessionThread(session) : undefined;
    const channel = slackThread?.channelId ?? body.channel?.id;
    const threadTs = slackThread?.threadTs ?? body.message?.thread_ts ?? body.message?.ts;

    if (!channel || !threadTs) {
      logger.error("Missing Slack channel, thread, or user on approval action.");
      await sendActionNotice({
        client,
        respond,
        userId,
        channel,
        text: "This approval is valid, but Relay could not identify the task thread. Open the task thread and try again."
      });
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
    let sourceSurfaceRefreshed = false;
    const refreshSourceSurface = async () => {
      if (sourceSurfaceRefreshed) {
        return;
      }

      sourceSurfaceRefreshed = true;
      await refreshApprovalSurface({
        body,
        client,
        logger,
        orchestrator,
        approvalId,
        userId
      });
    };
    const postApprovalProgress = async () => {
      if (progressPosted) {
        return;
      }

      progressPosted = true;
      await refreshSourceSurface();
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

    const execution = orchestrator.approveAndExecute(approvalId, userId, async () => {
        await postApprovalProgress();
      });

    if (orchestrator.getApproval(approvalId)?.status === "approved") {
      await postApprovalProgress();
    }

    void execution
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

        if (isApprovalStaleMessage(message)) {
          await sendActionNotice({
            client,
            respond,
            userId,
            channel,
            text: staleApprovalGuidance(message)
          });
          return;
        }

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
    const channel = body.channel?.id ?? body.container?.channel_id;
    const threadTs = body.message?.thread_ts ?? body.container?.thread_ts ?? body.message?.ts ?? body.container?.message_ts;
    const session =
      explicitSessionId && orchestrator.getSession(explicitSessionId)
        ? orchestrator.getSession(explicitSessionId)
        : channel && threadTs
          ? getSessionBySlackActionThread(orchestrator, { teamId, channelId: channel, threadTs })
          : undefined;

    if (!session) {
      await respond({
        response_type: "ephemeral",
        text: "This task is still starting or is not linked to a saved session yet. Try again after the next task update."
      });
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

      await postOrUpdateSourceMessage({
        client,
        channel,
        ts: body.message?.ts,
        threadTs,
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

      await postOrUpdateSourceMessage({
        client,
        channel,
        ts: body.message?.ts,
        threadTs,
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

function getSessionBySlackActionThread(
  orchestrator: Orchestrator,
  input: { teamId: string; channelId: string; threadTs: string }
): Session | undefined {
  const exact = orchestrator.getSessionBySlackThread(input);

  if (exact) {
    return exact;
  }

  return orchestrator.listSessions().find((session) => {
    const [teamId, channelId, threadTs] = session.slackThreadKey.split(":");
    return teamId === input.teamId && channelId === input.channelId && threadTs === input.threadTs;
  });
}

async function sendActionNotice(input: {
  client: any;
  respond?: (message: { response_type: "ephemeral"; text: string }) => Promise<void>;
  userId: string;
  channel?: string;
  text: string;
}): Promise<void> {
  if (input.respond) {
    try {
      await input.respond({ response_type: "ephemeral", text: input.text });
      return;
    } catch {
      // App Home actions may not have a response URL; fall back to direct user notification.
    }
  }

  if (input.channel) {
    try {
      await input.client.chat.postEphemeral({
        channel: input.channel,
        user: input.userId,
        text: input.text
      });
      return;
    } catch {
      // Fall through to App Home DM-style notification.
    }
  }

  await input.client.chat.postMessage({
    channel: input.userId,
    text: input.text
  });
}

function approvalStatusGuidance(status: string): string {
  if (status === "approved") {
    return "This approval was already accepted. Check the task thread for the current run status.";
  }

  if (status === "expired") {
    return "This approval expired. Ask Codex Relay to revise the plan or start a new task.";
  }

  if (status === "rejected") {
    return "This approval is no longer active. Open App Home or the task thread for the latest state.";
  }

  return `This approval is already ${status}. Open App Home or the task thread for the latest state.`;
}

function isApprovalStaleMessage(message: string): boolean {
  return (
    message === "Approval request was not found." ||
    message === "Approval request expired." ||
    message === "This approval is no longer available. Open App Home or the task thread for the latest state." ||
    message === "This approval expired. Ask Codex Relay to revise the plan or start a new task." ||
    message === "This approval was already accepted. Check the task thread for the current run status." ||
    message === "This approval is no longer active. Open App Home or the task thread for the latest state." ||
    /^Approval request is already /u.test(message)
  );
}

function staleApprovalGuidance(message: string): string {
  if (message.startsWith("This approval ")) {
    return message;
  }

  if (message === "Approval request was not found.") {
    return "This approval is no longer available. Open App Home or the task thread for the latest state.";
  }

  if (message === "Approval request expired.") {
    return "This approval expired. Ask Codex Relay to revise the plan or start a new task.";
  }

  const status = message.match(/^Approval request is already ([^.]+)\./u)?.[1];
  return approvalStatusGuidance(status ?? "inactive");
}

async function refreshApprovalSurface(input: {
  body: any;
  client: any;
  logger: any;
  orchestrator: Orchestrator;
  approvalId: string;
  userId: string;
}): Promise<void> {
  const approval = input.orchestrator.getApproval(input.approvalId);

  if (!approval) {
    return;
  }

  const session = input.orchestrator.getSession(approval.sessionId);
  const thread = session ? parseSessionThread(session) : undefined;
  const channel = input.body.channel?.id ?? thread?.channelId;
  const messageTs = input.body.message?.ts ?? (await findApprovalMessageTs(input));

  if (channel && messageTs) {
    try {
      await input.client.chat.update({
        channel,
        ts: messageTs,
        text: approval.type === "run_tests" ? "Codex test run approved." : "Codex execution approved.",
        blocks: approvalAcceptedBlocks(approval)
      });
    } catch (error) {
      input.logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  if (input.body.view || input.body.container?.type === "view") {
    try {
      await input.client.views.publish({
        user_id: input.userId,
        view: buildAppHomeView(input.orchestrator, input.userId)
      });
    } catch (error) {
      input.logger.warn(error instanceof Error ? error.message : String(error));
    }
  }
}

async function findApprovalMessageTs(input: {
  body: any;
  client: any;
  logger: any;
  orchestrator: Orchestrator;
  approvalId: string;
}): Promise<string | undefined> {
  const approval = input.orchestrator.getApproval(input.approvalId);
  const session = approval ? input.orchestrator.getSession(approval.sessionId) : undefined;

  if (!session) {
    return undefined;
  }

  const { channelId, threadTs } = parseSessionThread(session);

  try {
    const replies = await input.client.conversations?.replies?.({
      channel: channelId,
      ts: threadTs,
      limit: 100
    });

    if (!replies?.ok || !Array.isArray(replies.messages)) {
      return undefined;
    }

    const approvalMessage = replies.messages.find((message: any) => messageHasApprovalAction(message, input.approvalId));
    return approvalMessage?.ts;
  } catch (error) {
    input.logger.warn(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function messageHasApprovalAction(message: any, approvalId: string): boolean {
  const blocks = Array.isArray(message?.blocks) ? message.blocks : [];

  return blocks.some((block: any) => {
    const elements = Array.isArray(block?.elements) ? block.elements : [];
    return elements.some(
      (element: any) => element?.action_id === SlackActionIds.approveExecution && element?.value === approvalId
    );
  });
}

async function postOrUpdateSourceMessage(input: {
  client: any;
  channel: string;
  ts?: string;
  threadTs: string;
  text: string;
  blocks: unknown[];
}): Promise<void> {
  if (input.ts) {
    await input.client.chat.update({
      channel: input.channel,
      ts: input.ts,
      text: input.text,
      blocks: input.blocks
    });
    return;
  }

  await input.client.chat.postMessage({
    channel: input.channel,
    thread_ts: input.threadTs,
    text: input.text,
    blocks: input.blocks
  });
}
