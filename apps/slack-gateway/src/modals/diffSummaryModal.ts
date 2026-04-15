import type { View } from "@slack/types";
import type { Session } from "../../../../packages/shared/src/types.js";
import type { DiffSummary } from "../../../orchestrator/src/artifacts.js";

export function diffSummaryModal(input: { session: Session; diff: DiffSummary }): View {
  const changedFiles =
    input.diff.changedFiles.length > 0
      ? input.diff.changedFiles.map((file) => `- \`${file}\``).join("\n")
      : "No changed files detected.";

  const blocks: View["blocks"] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [`*Repo:* \`${input.session.repoId}\``, `*Branch:* \`${input.session.branchName}\``, `*Status:* \`${input.session.status}\``].join("\n")
      }
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Changed files*\n${truncate(changedFiles, 2800)}`
      }
    }
  ];

  if (input.diff.diffStat) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Diff stat*\n\`\`\`\n${truncate(input.diff.diffStat, 2600)}\n\`\`\``
      }
    });
  }

  if (input.diff.nameStatus) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Name status*\n\`\`\`\n${truncate(input.diff.nameStatus, 2600)}\n\`\`\``
      }
    });
  }

  if (input.diff.patchPreview) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Patch preview*\n\`\`\`\n${truncate(input.diff.patchPreview, 2600)}\n\`\`\``
      }
    });
  }

  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: "Diff summary"
    },
    close: {
      type: "plain_text",
      text: "Close"
    },
    blocks
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 20)}\n... truncated ...`;
}
