import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const userPathspec = ["--", ".", ":(exclude).codex"];

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface BranchDivergence {
  upstream?: string;
  behind: number;
  ahead: number;
}

export async function runGit(args: string[], cwd: string): Promise<CommandResult> {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024 * 16
  });

  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString()
  };
}

export async function assertGitRepo(path: string): Promise<string> {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], path);

  if (inside.stdout.trim() !== "true") {
    throw new Error(`${path} is not inside a git work tree.`);
  }

  const root = await runGit(["rev-parse", "--show-toplevel"], path);
  return root.stdout.trim();
}

export async function getChangedFiles(path: string): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    runGit(["diff", "--name-only", ...userPathspec], path),
    runGit(["ls-files", "--others", "--exclude-standard", ...userPathspec], path)
  ]);
  return uniqueLines(`${tracked.stdout}\n${untracked.stdout}`);
}

export async function getChangedFilesSince(path: string, baseSha: string): Promise<string[]> {
  const tracked = await runGit(["diff", "--name-only", `${baseSha}..HEAD`, ...userPathspec], path);
  return uniqueLines(tracked.stdout);
}

export async function getDiffStat(path: string): Promise<string> {
  const [tracked, untracked] = await Promise.all([
    runGit(["diff", "--stat", ...userPathspec], path),
    runGit(["ls-files", "--others", "--exclude-standard", ...userPathspec], path)
  ]);
  const untrackedFiles = uniqueLines(untracked.stdout);
  const untrackedStat =
    untrackedFiles.length > 0 ? ["Untracked files:", ...untrackedFiles.map((file) => `  ${file}`)].join("\n") : "";
  return [tracked.stdout.trim(), untrackedStat].filter(Boolean).join("\n");
}

export async function getNameStatus(path: string): Promise<string> {
  const [tracked, untracked] = await Promise.all([
    runGit(["diff", "--name-status", ...userPathspec], path),
    runGit(["ls-files", "--others", "--exclude-standard", ...userPathspec], path)
  ]);
  const untrackedStatus = uniqueLines(untracked.stdout)
    .map((file) => `??\t${file}`)
    .join("\n");
  return [tracked.stdout.trim(), untrackedStatus].filter(Boolean).join("\n");
}

export async function getDiffSummaryPatch(path: string): Promise<string> {
  const result = await runGit(["diff", "--stat", "--patch", ...userPathspec], path);
  return result.stdout.trim();
}

export async function getPorcelainStatus(path: string): Promise<string> {
  const result = await runGit(["status", "--porcelain", ...userPathspec], path);
  return result.stdout.trim();
}

export async function getCurrentBranch(path: string): Promise<string> {
  const result = await runGit(["branch", "--show-current"], path);
  return result.stdout.trim();
}

export async function getHeadSha(path: string): Promise<string> {
  const result = await runGit(["rev-parse", "HEAD"], path);
  return result.stdout.trim();
}

export async function getUpstreamBranch(path: string): Promise<string | undefined> {
  try {
    const result = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], path);
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function getBranchDivergence(path: string, upstream: string): Promise<BranchDivergence> {
  const result = await runGit(["rev-list", "--left-right", "--count", `${upstream}...HEAD`], path);
  const [behindText = "0", aheadText = "0"] = result.stdout.trim().split(/\s+/);
  const behind = Number.parseInt(behindText, 10);
  const ahead = Number.parseInt(aheadText, 10);

  return {
    upstream,
    behind: Number.isFinite(behind) ? behind : 0,
    ahead: Number.isFinite(ahead) ? ahead : 0
  };
}

export async function isAncestor(path: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await runGit(["merge-base", "--is-ancestor", ancestor, descendant], path);
    return true;
  } catch {
    return false;
  }
}

function uniqueLines(value: string): string[] {
  return [...new Set(value.split("\n").map((line) => line.trim()).filter(Boolean))];
}
