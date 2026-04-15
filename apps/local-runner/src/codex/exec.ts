import type { RunnerTaskSpec } from "../../../../packages/shared/src/types.js";

export function buildCodexExecArgs(task: RunnerTaskSpec): string[] {
  const profile = runnerProfileForTask(task);
  const args = [
    "exec",
    "--json",
    "--color",
    "never",
    "--profile",
    profile,
    "-c",
    `profiles.${profile}.sandbox_mode="${task.sandbox}"`,
    "-c",
    'approval_policy="never"',
    "-c",
    "sandbox_workspace_write.network_access=false",
    "--cd",
    task.workspacePath,
    "--sandbox",
    task.sandbox
  ];

  if (task.model) {
    args.push("--model", task.model);
  }

  for (const image of task.images ?? []) {
    args.push("--image", image);
  }

  args.push(task.prompt);
  return args;
}

export function buildCodexExecResumeArgs(task: RunnerTaskSpec, codexSessionId: string): string[] {
  const profile = runnerProfileForTask(task);
  const args = [
    "exec",
    "--json",
    "--color",
    "never",
    "--profile",
    profile,
    "-c",
    `profiles.${profile}.sandbox_mode="${task.sandbox}"`,
    "-c",
    'approval_policy="never"',
    "-c",
    "sandbox_workspace_write.network_access=false",
    "--cd",
    task.workspacePath,
    "--sandbox",
    task.sandbox
  ];

  if (task.model) {
    args.push("--model", task.model);
  }

  args.push("resume", codexSessionId, task.prompt);
  return args;
}

export function runnerProfileForTask(task: RunnerTaskSpec): string {
  if (task.mode === "plan" || task.mode === "review" || task.mode === "explain") {
    return "codex_relay_readonly";
  }

  return "codex_relay_write";
}
