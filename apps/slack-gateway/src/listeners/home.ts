import type { App } from "@slack/bolt";
import { SlackActionIds } from "../../../../packages/shared/src/events.js";
import type { Orchestrator } from "../../../orchestrator/src/tasks.js";

export function registerHomeListeners(app: App, orchestrator: Orchestrator): void {
  app.event("app_home_opened", async ({ event, client }) => {
    await client.views.publish({
      user_id: event.user,
      view: buildAppHomeView(orchestrator, event.user)
    });
  });
}

export function buildAppHomeView(orchestrator: Orchestrator, slackUserId: string) {
  const sessions = orchestrator
      .listSessions()
      .filter((session) => session.ownerSlackUserId === slackUserId)
      .slice(0, 10);
  const approvals = orchestrator.listPendingApprovalsForUser(slackUserId).slice(0, 5);
  const auditEvents = orchestrator.listAuditEventsForSlackUser(slackUserId, 8);
  const approvalBlocks =
    approvals.length === 0
      ? [
          {
            type: "section" as const,
            text: {
              type: "mrkdwn" as const,
              text: "No pending approvals."
            }
          }
        ]
      : approvals.flatMap((approval) => {
          const session = orchestrator.getSession(approval.sessionId);
          return [
            {
              type: "section" as const,
              text: {
                type: "mrkdwn" as const,
                text: [
                  `*Approval needed* repo:\`${session?.repoId ?? "unknown"}\``,
                  `Branch: \`${session?.branchName ?? "unknown"}\``,
                  `Expires: ${new Date(approval.expiresAt).toLocaleString()}`
                ].join("\n")
              }
            },
            {
              type: "actions" as const,
              elements: [
                {
                  type: "button" as const,
                  text: { type: "plain_text" as const, text: "Approve execution" },
                  action_id: SlackActionIds.approveExecution,
                  value: approval.id,
                  style: "primary" as const
                }
              ]
            }
          ];
        });

  return {
    type: "home" as const,
    blocks: [
      {
        type: "header" as const,
        text: { type: "plain_text" as const, text: "Codex Relay" }
      },
      {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: "*Pending approvals*" }
      },
      ...approvalBlocks,
      { type: "divider" as const },
      {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: "*Recent sessions*" }
      },
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text:
            sessions.length === 0
              ? "No active tasks."
              : sessions
                  .map((session) =>
                    [
                      `*${session.status}* repo:\`${session.repoId}\` branch:\`${session.branchName}\``,
                      ...(session.draftPullRequest ? [`PR: ${session.draftPullRequest.prUrl}`] : [])
                    ].join("\n")
                  )
                  .join("\n")
        }
      },
      { type: "divider" as const },
      {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: "*Recent audit events*" }
      },
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text:
            auditEvents.length === 0
              ? "No audit events yet."
              : auditEvents
                  .map((auditEvent) =>
                    [
                      `*${auditEvent.outcome}* \`${auditEvent.type}\``,
                      `${auditEvent.repoId ? `repo:\`${auditEvent.repoId}\` ` : ""}${auditEvent.summary}`
                    ].join("\n")
                  )
                  .join("\n")
        }
      }
    ]
  };
}
