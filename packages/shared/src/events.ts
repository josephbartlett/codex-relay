export const SlackActionIds = {
  approveExecution: "codex.approve_execution",
  revisePlan: "codex.revise_plan",
  cancelTask: "codex.cancel_task",
  openDetails: "codex.open_details",
  createPr: "codex.create_pr",
  checkPrStatus: "codex.check_pr_status",
  markPrReady: "codex.mark_pr_ready"
} as const;

export const SlackShortcutIds = {
  runWithCodex: "run_with_codex"
} as const;

export const SlackViewCallbackIds = {
  shortcutNewTask: "codex.shortcut.new_task"
} as const;

export const SlackCommand = "/codex";
