import type { View } from "@slack/types";

export const newTaskModalCallbackId = "codex.modal.new_task";

export function newTaskModal(input: { defaultRepoId: string; channelId: string; teamId: string }): View {
  return {
    type: "modal",
    callback_id: newTaskModalCallbackId,
    title: { type: "plain_text", text: "New Codex Task" },
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
          placeholder: { type: "plain_text", text: "default" },
          initial_value: input.defaultRepoId
        }
      },
      {
        type: "input",
        block_id: "task",
        label: { type: "plain_text", text: "Task" },
        element: {
          type: "plain_text_input",
          action_id: "text",
          multiline: true
        }
      }
    ],
    private_metadata: JSON.stringify({
      channelId: input.channelId,
      teamId: input.teamId
    })
  };
}
