import { pathToFileURL } from "node:url";
import { loadConfig } from "../../../packages/shared/src/config.js";
import type { TaskMode } from "../../../packages/shared/src/types.js";
import { buildSlackTaskContext } from "../../orchestrator/src/context.js";
import { loadConfiguredStore } from "../../orchestrator/src/persistence/storeFactory.js";
import { ExecAdapter } from "../../orchestrator/src/runner/ExecAdapter.js";
import { Orchestrator, type EnqueueLocalHandoffResult } from "../../orchestrator/src/tasks.js";

export interface LocalSessionCliOptions {
  repoId?: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  userId: string;
  prompt: string;
  mode: Extract<TaskMode, "plan" | "implement" | "test">;
  maxAttempts?: number;
}

export function parseLocalSessionArgs(argv: string[]): LocalSessionCliOptions {
  const options: Partial<LocalSessionCliOptions> = {
    mode: "plan"
  };
  const promptParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      throw new LocalSessionHelpRequested();
    }

    if (arg === "--") {
      promptParts.push(...argv.slice(index + 1));
      break;
    }

    if (arg?.startsWith("--thread-key=")) {
      applyThreadKey(options, arg.slice("--thread-key=".length));
      continue;
    }

    if (arg === "--thread-key") {
      applyThreadKey(options, requireValue(argv, (index += 1), "--thread-key"));
      continue;
    }

    if (arg?.startsWith("--repo=")) {
      options.repoId = arg.slice("--repo=".length);
      continue;
    }

    if (arg === "--repo") {
      options.repoId = requireValue(argv, (index += 1), "--repo");
      continue;
    }

    if (arg?.startsWith("--team=")) {
      options.teamId = arg.slice("--team=".length);
      continue;
    }

    if (arg === "--team") {
      options.teamId = requireValue(argv, (index += 1), "--team");
      continue;
    }

    if (arg?.startsWith("--channel=")) {
      options.channelId = arg.slice("--channel=".length);
      continue;
    }

    if (arg === "--channel") {
      options.channelId = requireValue(argv, (index += 1), "--channel");
      continue;
    }

    if (arg?.startsWith("--thread=")) {
      options.threadTs = arg.slice("--thread=".length);
      continue;
    }

    if (arg === "--thread") {
      options.threadTs = requireValue(argv, (index += 1), "--thread");
      continue;
    }

    if (arg?.startsWith("--user=")) {
      options.userId = arg.slice("--user=".length);
      continue;
    }

    if (arg === "--user") {
      options.userId = requireValue(argv, (index += 1), "--user");
      continue;
    }

    if (arg?.startsWith("--mode=")) {
      options.mode = parseMode(arg.slice("--mode=".length));
      continue;
    }

    if (arg === "--mode") {
      options.mode = parseMode(requireValue(argv, (index += 1), "--mode"));
      continue;
    }

    if (arg?.startsWith("--prompt=")) {
      options.prompt = arg.slice("--prompt=".length);
      continue;
    }

    if (arg === "--prompt") {
      options.prompt = requireValue(argv, (index += 1), "--prompt");
      continue;
    }

    if (arg?.startsWith("--max-attempts=")) {
      options.maxAttempts = parseMaxAttempts(arg.slice("--max-attempts=".length));
      continue;
    }

    if (arg === "--max-attempts") {
      options.maxAttempts = parseMaxAttempts(requireValue(argv, (index += 1), "--max-attempts"));
      continue;
    }

    if (arg?.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    promptParts.push(arg ?? "");
  }

  if (!options.prompt && promptParts.length > 0) {
    options.prompt = promptParts.join(" ").trim();
  }

  assertRequired(options.teamId, "--team or --thread-key");
  assertRequired(options.channelId, "--channel or --thread-key");
  assertRequired(options.threadTs, "--thread or --thread-key");
  assertRequired(options.userId, "--user");
  assertRequired(options.prompt, "--prompt or trailing prompt text");

  return options as LocalSessionCliOptions;
}

export async function enqueueLocalSession(options: LocalSessionCliOptions): Promise<EnqueueLocalHandoffResult> {
  const config = loadConfig(process.env, { requireSlack: false });
  const store = loadConfiguredStore(config);
  const runner = new ExecAdapter({
    command: config.codex.command,
    model: config.codex.model,
    envAllowlist: config.codex.runnerEnvAllowlist
  });
  const orchestrator = new Orchestrator(config, store, runner);
  const slack = buildSlackTaskContext({
    teamId: options.teamId,
    channelId: options.channelId,
    threadTs: options.threadTs,
    requestingUserId: options.userId,
    text: options.repoId ? `repo:${options.repoId} ${options.prompt}` : options.prompt
  });

  return orchestrator.enqueueLocalHandoffFromSlack({
    slack,
    repoId: options.repoId,
    mode: options.mode,
    maxAttempts: options.maxAttempts
  });
}

export function formatLocalSessionResult(result: EnqueueLocalHandoffResult): string {
  return [
    "Codex Relay local session enqueued.",
    `Session: ${result.session.id}`,
    `Repo: ${result.session.repoId}`,
    `Mode: ${result.taskRun.mode}`,
    `Branch: ${result.session.branchName}`,
    `Worktree: ${result.session.workspacePath}`,
    `Queue job: ${result.job.id}`,
    "",
    "Keep `npm run dev:runner` and `npm run dev:slack` running against the same store to execute the job and deliver Slack updates."
  ].join("\n");
}

function applyThreadKey(options: Partial<LocalSessionCliOptions>, threadKey: string): void {
  const [teamId, channelId, threadTs] = threadKey.split(":");

  if (!teamId || !channelId || !threadTs) {
    throw new Error("--thread-key must use TEAM:CHANNEL:THREAD_TS.");
  }

  options.teamId = teamId;
  options.channelId = channelId;
  options.threadTs = threadTs;
}

function parseMode(value: string): Extract<TaskMode, "plan" | "implement" | "test"> {
  if (value === "plan" || value === "implement" || value === "test") {
    return value;
  }

  throw new Error("--mode must be one of: plan, implement, test.");
}

function parseMaxAttempts(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
    throw new Error("--max-attempts must be an integer between 1 and 10.");
  }

  return parsed;
}

function requireValue(argv: string[], index: number, name: string): string {
  const value = argv[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function assertRequired(value: string | undefined, name: string): void {
  if (!value?.trim()) {
    throw new Error(`${name} is required.`);
  }
}

export class LocalSessionHelpRequested extends Error {
  constructor() {
    super("Local session help requested.");
    this.name = "LocalSessionHelpRequested";
  }
}

function helpText(): string {
  return `Usage:
  npm run local:session -- --thread-key TEAM:CHANNEL:THREAD_TS --user U123 --repo default --mode implement --prompt "make the change"

Options:
  --thread-key TEAM:CHANNEL:THREAD_TS  Slack thread to receive updates.
  --team TEAM                         Slack team id. Alternative to --thread-key.
  --channel CHANNEL                   Slack channel id. Alternative to --thread-key.
  --thread THREAD_TS                  Slack thread timestamp. Alternative to --thread-key.
  --user USER                         Slack user id that owns the handoff.
  --repo REPO                         Repo binding id. Defaults to CODEX_DEFAULT_REPO_ID.
  --mode plan|implement|test          Runner mode. Defaults to plan.
  --prompt TEXT                       Local handoff request.
  --max-attempts N                    Queue retry limit, 1-10.

The command enqueues work only. Run the local runner and Slack gateway against the same store to execute and notify.`;
}

async function main(): Promise<void> {
  try {
    const options = parseLocalSessionArgs(process.argv.slice(2));
    const result = await enqueueLocalSession(options);
    process.stdout.write(`${formatLocalSessionResult(result)}\n`);
  } catch (error) {
    if (error instanceof LocalSessionHelpRequested) {
      process.stdout.write(`${helpText()}\n`);
      return;
    }

    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
