import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HarnessConfig } from "../../../packages/shared/src/config.js";
import { assertGitRepo, runGit } from "./git.js";

const execFileAsync = promisify(execFile);

export interface StartupCheckReport {
  failures: string[];
  warnings: string[];
}

const requiredRunnerProfiles = [
  { name: "codex_relay_readonly", sandbox: "read-only" },
  { name: "codex_relay_write", sandbox: "workspace-write" },
  { name: "codex_relay_pr", sandbox: "workspace-write" },
  { name: "codex_relay_cleanup", sandbox: "read-only" }
];

export async function runStartupChecks(config: HarnessConfig): Promise<StartupCheckReport> {
  const failures: string[] = [];
  const warnings: string[] = [];

  await collect(failures, "git is not available", async () => {
    await runGit(["--version"], process.cwd());
  });

  await collect(failures, "Codex CLI is not available or not authenticated", async () => {
    await execFileAsync(config.codex.command, ["login", "status"], { maxBuffer: 1024 * 1024 });
  });

  await collect(warnings, "GitHub CLI is not available or not authenticated; Create PR will fail until gh is configured", async () => {
    await execFileAsync("gh", ["auth", "status"], { maxBuffer: 1024 * 1024 });
  });

  await collect(failures, `Worktree root is not writable: ${config.codex.worktreeRoot}`, async () => {
    await mkdir(config.codex.worktreeRoot, { recursive: true });
    await access(config.codex.worktreeRoot, constants.W_OK);
  });

  const stateDirectory = config.codex.storeKind === "sqlite"
    ? dirname(config.codex.databasePath)
    : dirname(config.codex.statePath);
  const stateDescription = config.codex.storeKind === "sqlite"
    ? `SQLite database directory is not writable: ${stateDirectory}`
    : `State path directory is not writable: ${stateDirectory}`;

  await collect(failures, stateDescription, async () => {
    await mkdir(stateDirectory, { recursive: true });
    await access(stateDirectory, constants.W_OK);
  });

  for (const repo of config.repos) {
    await collect(failures, `Configured repo '${repo.id}' is not a git repository at ${repo.path}`, async () => {
      await assertGitRepo(repo.path);
    });
  }

  const policyReport = await runRunnerPolicyChecks(config);
  failures.push(...policyReport.failures);
  warnings.push(...policyReport.warnings);

  return { failures, warnings };
}

export async function runRunnerPolicyChecks(config: HarnessConfig): Promise<StartupCheckReport> {
  const failures: string[] = [];
  const warnings: string[] = [];
  let profilesContent = "";
  let rulesContent = "";

  await collect(failures, `Codex runner profiles file is not readable: ${config.codex.profilesPath}`, async () => {
    profilesContent = await readFile(config.codex.profilesPath, "utf8");
  });

  await collect(failures, `Codex execpolicy rules file is not readable: ${config.codex.rulesPath}`, async () => {
    rulesContent = await readFile(config.codex.rulesPath, "utf8");
  });

  if (profilesContent || rulesContent) {
    const evaluated = evaluateRunnerPolicyFiles({ profilesContent, rulesContent });
    failures.push(...evaluated.failures);
    warnings.push(...evaluated.warnings);
  }

  if (rulesContent) {
    const target = config.codex.requireExecPolicyCheck ? failures : warnings;
    const validationMessage = config.codex.requireExecPolicyCheck
      ? "Codex execpolicy validation could not be run"
      : "Codex execpolicy validation could not be run; validate rules manually before release";

    await collect(target, validationMessage, async () => {
      await execFileAsync(
        config.codex.command,
        [
          "execpolicy",
          "check",
          "--pretty",
          "--rules",
          config.codex.rulesPath,
          "--",
          "git",
          "status",
          "--short"
        ],
        { maxBuffer: 1024 * 1024 }
      );
    });
  }

  return { failures, warnings };
}

export function evaluateRunnerPolicyFiles(input: { profilesContent: string; rulesContent: string }): StartupCheckReport {
  const failures: string[] = [];
  const warnings: string[] = [];
  const rulesContent = stripHashComments(input.rulesContent);
  const ruleBlocks = extractExecPolicyRuleBlocks(rulesContent);

  for (const profile of requiredRunnerProfiles) {
    const block = extractTomlTable(input.profilesContent, `profiles.${profile.name}`);

    if (!block) {
      failures.push(`Codex runner profile '${profile.name}' is missing.`);
      continue;
    }

    const sandbox = extractTomlStringValue(block, "sandbox_mode");

    if (sandbox !== profile.sandbox) {
      failures.push(`Codex runner profile '${profile.name}' must use sandbox_mode '${profile.sandbox}'.`);
    }
  }

  if (/sandbox_mode\s*=\s*["']danger-full-access["']/u.test(input.profilesContent)) {
    failures.push("Codex runner profiles must not use danger-full-access.");
  }

  if (/network_access\s*=\s*true/u.test(input.profilesContent)) {
    failures.push("Codex runner profiles must not enable network_access by default.");
  }

  if (!/network_access\s*=\s*false/u.test(input.profilesContent)) {
    warnings.push("Codex runner profiles do not explicitly set network_access = false.");
  }

  if (ruleBlocks.length === 0) {
    failures.push("Codex execpolicy rules must include prefix_rule blocks.");
  }

  const ruleChecks: Array<{ label: string; matches: (block: string) => boolean }> = [
    {
      label: "recursive delete",
      matches: (block) => containsForbiddenDecision(block) && /pattern\s*=\s*\[\s*["']rm["']\s*,\s*["']-r[f]?["']\s*\]/u.test(block)
    },
    {
      label: "git remote mutation",
      matches: (block) => containsForbiddenDecision(block) && /pattern\s*=\s*\[\s*["']git["']\s*,\s*["']remote["']/u.test(block)
    },
    {
      label: "network tools",
      matches: (block) =>
        containsForbiddenDecision(block) && /pattern\s*=\s*\[\s*\[\s*["']curl["']\s*,\s*["']wget["']/u.test(block)
    },
    {
      label: "destructive Docker cleanup",
      matches: (block) =>
        containsForbiddenDecision(block) && /pattern\s*=\s*\[\s*["']docker["']\s*,\s*\[\s*["']system["']/u.test(block)
    }
  ];

  for (const check of ruleChecks) {
    if (!ruleBlocks.some((block) => check.matches(block))) {
      failures.push(`Codex execpolicy rules are missing a ${check.label} guard.`);
    }
  }

  if (!ruleBlocks.some((block) => containsForbiddenDecision(block))) {
    failures.push("Codex execpolicy rules must include forbidden decisions for dangerous commands.");
  }

  return { failures, warnings };
}

function extractTomlTable(content: string, tableName: string): string | undefined {
  const lines = content.split(/\r?\n/u);
  const body: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const tableNameMatch = trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : undefined;

    if (tableNameMatch) {
      if (capturing) {
        break;
      }

      capturing = tableNameMatch === tableName;
      continue;
    }

    if (capturing) {
      body.push(line);
    }
  }

  return capturing ? body.join("\n") : undefined;
}

function extractExecPolicyRuleBlocks(content: string): string[] {
  const blocks: string[] = [];
  const lines = content.split(/\r?\n/u);
  let current: string[] | undefined;

  for (const line of lines) {
    if (/^\s*prefix_rule\s*\(/u.test(line)) {
      current = [line];
      continue;
    }

    if (!current) {
      continue;
    }

    current.push(line);

    if (/^\s*\)\s*,?\s*$/u.test(line)) {
      blocks.push(current.join("\n"));
      current = undefined;
    }
  }

  return blocks;
}

function containsForbiddenDecision(block: string): boolean {
  return /^\s*decision\s*=\s*["']forbidden["']/mu.test(block);
}

function stripHashComments(content: string): string {
  return content
    .split(/\r?\n/u)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

function extractTomlStringValue(block: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^\\s*${escaped}\\s*=\\s*["']([^"']+)["']`, "mu").exec(block);
  return match?.[1];
}

async function collect(target: string[], message: string, check: () => Promise<void>): Promise<void> {
  try {
    await check();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    target.push(`${message}: ${detail}`);
  }
}
