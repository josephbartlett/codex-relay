import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  DraftPullRequestCheckDetail,
  DraftPullRequestCheckState,
  DraftPullRequestReadyResult,
  DraftPullRequestResult,
  DraftPullRequestStatus
} from "../../../packages/shared/src/types.js";
import {
  getChangedFiles,
  getChangedFilesSince,
  getBranchDivergence,
  getCurrentBranch,
  getHeadSha,
  getPorcelainStatus,
  getUpstreamBranch,
  isAncestor,
  runGit,
  type CommandResult
} from "./git.js";

const execFileAsync = promisify(execFile);
const MAX_STORED_CHECK_DETAILS = 20;

export interface DraftPullRequestInput {
  workspacePath: string;
  branchName: string;
  title: string;
  body: string;
  existingPullRequest?: DraftPullRequestResult;
}

export interface DraftPullRequestStatusInput {
  workspacePath: string;
  prUrl: string;
}

export interface MarkDraftPullRequestReadyInput extends DraftPullRequestStatusInput {
  branchName: string;
}

export interface PullRequestCommandRunner {
  git(args: string[], cwd: string): Promise<CommandResult>;
  gh(args: string[], cwd: string): Promise<CommandResult>;
}

export async function createDraftPullRequest(
  input: DraftPullRequestInput,
  runner: PullRequestCommandRunner = defaultPullRequestCommandRunner
): Promise<DraftPullRequestResult> {
  const existingPullRequest = input.existingPullRequest;

  if (existingPullRequest && !existingPullRequest.prUrl.trim()) {
    throw new Error("Existing pull request metadata is missing a PR URL.");
  }

  if (existingPullRequest && existingPullRequest.branchName !== input.branchName) {
    throw new Error(
      `Existing pull request branch '${existingPullRequest.branchName}' does not match expected branch '${input.branchName}'.`
    );
  }

  if (existingPullRequest) {
    await assertPullRequestMatchesOrigin({
      prUrl: existingPullRequest.prUrl,
      workspacePath: input.workspacePath,
      runner
    });
  }

  const status = await getPorcelainStatus(input.workspacePath);
  const headBeforeCommit = existingPullRequest ? await getHeadSha(input.workspacePath) : undefined;
  const branchState = await assertPullRequestBranchState({
    workspacePath: input.workspacePath,
    branchName: input.branchName,
    existingPullRequest,
    headBeforeCommit
  });

  if (!status && existingPullRequest) {
    const recoveredCommitSha = headBeforeCommit;

    if (!recoveredCommitSha || recoveredCommitSha === existingPullRequest.commitSha) {
      return existingPullRequest;
    }

    const changedFiles = await getChangedFilesSince(input.workspacePath, existingPullRequest.commitSha);

    await editExistingPullRequest({
      runner,
      workspacePath: input.workspacePath,
      prUrl: existingPullRequest.prUrl,
      title: input.title,
      body: input.body
    });

    return {
      title: input.title,
      body: input.body,
      branchName: input.branchName,
      commitSha: recoveredCommitSha,
      prUrl: existingPullRequest.prUrl,
      changedFiles: changedFiles.length > 0 ? changedFiles : existingPullRequest.changedFiles
    };
  }

  if (!status) {
    throw new Error("No worktree changes found to commit for a pull request.");
  }

  const unmerged = findUnmergedStatusLines(status);

  if (unmerged.length > 0) {
    throw new Error(`Cannot create PR with unmerged paths:\n${unmerged.join("\n")}`);
  }

  const staged = findStagedStatusLines(status);

  if (staged.length > 0) {
    throw new Error(`Cannot create PR with pre-staged changes. Leave the index clean before PR handoff:\n${staged.join("\n")}`);
  }

  const changedFiles = await getChangedFiles(input.workspacePath);

  await runner.git(["add", "-A", "--", ".", ":(exclude).codex"], input.workspacePath);
  await runner.git(["commit", "-m", input.title, "-m", input.body], input.workspacePath);
  const commitSha = await getHeadSha(input.workspacePath);
  await assertPushWouldNotHideRemoteCommits({
    workspacePath: input.workspacePath,
    branchName: input.branchName,
    upstream: branchState.upstream
  });
  await runner.git(["push", "-u", "origin", input.branchName], input.workspacePath);

  if (existingPullRequest) {
    await editExistingPullRequest({
      runner,
      workspacePath: input.workspacePath,
      prUrl: existingPullRequest.prUrl,
      title: input.title,
      body: input.body
    });

    return {
      title: input.title,
      body: input.body,
      branchName: input.branchName,
      commitSha,
      prUrl: existingPullRequest.prUrl,
      changedFiles
    };
  }

  const pr = await runner.gh(
    ["pr", "create", "--draft", "--title", input.title, "--body", input.body, "--head", input.branchName],
    input.workspacePath
  );
  const prUrl = extractPrUrl(pr.stdout || pr.stderr);

  if (!prUrl) {
    throw new Error("GitHub CLI did not return a pull request URL.");
  }

  return {
    title: input.title,
    body: input.body,
    branchName: input.branchName,
    commitSha,
    prUrl,
    changedFiles
  };
}

export async function getDraftPullRequestStatus(
  input: DraftPullRequestStatusInput,
  runner: PullRequestCommandRunner = defaultPullRequestCommandRunner
): Promise<DraftPullRequestStatus> {
  if (!input.prUrl.trim()) {
    throw new Error("Pull request URL is required to check PR status.");
  }

  await assertPullRequestMatchesOrigin({
    prUrl: input.prUrl,
    workspacePath: input.workspacePath,
    runner
  });

  const status = await runner.gh(
    ["pr", "view", input.prUrl, "--json", "state,isDraft,mergeable,statusCheckRollup,url,headRefName"],
    input.workspacePath
  );
  return parsePullRequestStatus(status.stdout, input.prUrl);
}

export async function markDraftPullRequestReadyForReview(
  input: MarkDraftPullRequestReadyInput,
  runner: PullRequestCommandRunner = defaultPullRequestCommandRunner
): Promise<DraftPullRequestReadyResult> {
  if (!input.prUrl.trim()) {
    throw new Error("Pull request URL is required to mark ready for review.");
  }

  const currentBranch = await getCurrentBranch(input.workspacePath);

  if (currentBranch !== input.branchName) {
    throw new Error(`Worktree is on branch '${currentBranch}', expected '${input.branchName}'.`);
  }

  await assertPullRequestMatchesOrigin({
    prUrl: input.prUrl,
    workspacePath: input.workspacePath,
    runner
  });

  const before = await getDraftPullRequestStatus(input, runner);
  assertPullRequestStatusMatchesBranch(before, input.branchName);
  assertPullRequestIsOpen(before);

  if (before.isDraft === false) {
    return { ...before, operation: "already_ready" };
  }

  await runner.gh(["pr", "ready", input.prUrl], input.workspacePath);
  const after = await getDraftPullRequestStatus(input, runner);
  assertPullRequestStatusMatchesBranch(after, input.branchName);

  return { ...after, operation: "ready" };
}

export const defaultPullRequestCommandRunner: PullRequestCommandRunner = {
  git: runGit,
  async gh(args, cwd) {
    const result = await execFileAsync("gh", args, {
      cwd,
      maxBuffer: 1024 * 1024 * 16
    });

    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString()
    };
  }
};

export function buildPullRequestTitle(summary: string, sessionId: string): string {
  const firstUsefulLine =
    summary
      .split(/\r?\n/)
      .map((line) => cleanSummaryLine(line))
      .find((line) => line.length > 0 && !isSectionHeading(line)) ?? `Slack task ${sessionId}`;
  const withoutLabel = firstUsefulLine.replace(/^summary:\s*/i, "").trim();
  const title = withoutLabel.startsWith("Codex:") ? withoutLabel : `Codex: ${withoutLabel}`;
  return truncateSingleLine(title, 90);
}

export function buildPullRequestBody(input: {
  sessionId: string;
  repoId: string;
  branchName: string;
  summary: string;
  changedFiles: string[];
}): string {
  return [
    "## Summary",
    sanitizeSummaryForPullRequest(input.summary.trim()) || "Codex Slack task changes.",
    "",
    "## Changed Files",
    input.changedFiles.length > 0
      ? input.changedFiles.map((file) => `- \`${escapeMarkdownCodeSpan(file)}\``).join("\n")
      : "- No changed files reported before commit.",
    "",
    "## Harness Metadata",
    `- Session: \`${input.sessionId}\``,
    `- Repo: \`${input.repoId}\``,
    `- Branch: \`${input.branchName}\``,
    "- Created by Codex Relay"
  ].join("\n");
}

export function extractPrUrl(output: string): string | undefined {
  const match = output.match(/https:\/\/[^\s]+\/pull\/\d+/);
  return match?.[0];
}

export function parsePullRequestStatus(output: string, fallbackPrUrl: string): DraftPullRequestStatus {
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(output) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Could not parse GitHub PR status output: ${error instanceof Error ? error.message : String(error)}`);
  }

  const checks = normalizeCheckRollup(parsed.statusCheckRollup);
  const counts = summarizeChecks(checks.details);
  const prUrl = stringField(parsed.url) ?? fallbackPrUrl;

  return {
    prUrl,
    state: stringField(parsed.state),
    isDraft: typeof parsed.isDraft === "boolean" ? parsed.isDraft : undefined,
    mergeable: stringField(parsed.mergeable) ?? null,
    headRefName: stringField(parsed.headRefName),
    checksSummary: formatChecksSummary(counts),
    checksTotal: counts.total,
    checksPassed: counts.passed,
    checksFailed: counts.failed,
    checksPending: counts.pending,
    checkDetails: checks.details.slice(0, MAX_STORED_CHECK_DETAILS),
    checksHidden: Math.max(0, checks.details.length - MAX_STORED_CHECK_DETAILS),
    checkedAt: new Date().toISOString()
  };
}

function findUnmergedStatusLines(status: string): string[] {
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => {
      const code = line.slice(0, 2);
      return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(code) || code.includes("U");
    });
}

function findStagedStatusLines(status: string): string[] {
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => {
      const indexStatus = line[0] ?? " ";
      return indexStatus !== " " && indexStatus !== "?";
    });
}

async function assertPullRequestBranchState(input: {
  workspacePath: string;
  branchName: string;
  existingPullRequest?: DraftPullRequestResult;
  headBeforeCommit?: string;
}): Promise<{ upstream?: string }> {
  const currentBranch = await getCurrentBranch(input.workspacePath);

  if (!currentBranch) {
    throw new Error(`Worktree is in detached HEAD state, expected branch '${input.branchName}'.`);
  }

  if (currentBranch !== input.branchName) {
    throw new Error(`Worktree is on branch '${currentBranch}', expected '${input.branchName}'.`);
  }

  const upstream = await getUpstreamBranch(input.workspacePath);

  if (upstream) {
    const divergence = await getBranchDivergence(input.workspacePath, upstream);

    if (divergence.behind > 0) {
      throw new Error(
        `Worktree branch '${input.branchName}' is behind upstream '${upstream}' by ${divergence.behind} commit(s). Fetch/rebase or recreate the session worktree before PR handoff.`
      );
    }

    if (!input.existingPullRequest && divergence.ahead > 0) {
      throw new Error(
        `Worktree branch '${input.branchName}' already has ${divergence.ahead} commit(s) ahead of upstream '${upstream}' before first PR handoff.`
      );
    }
  }

  if (
    input.existingPullRequest &&
    input.headBeforeCommit &&
    input.headBeforeCommit !== input.existingPullRequest.commitSha
  ) {
    if (!upstream) {
      throw new Error(
        `Cannot recover PR update for branch '${input.branchName}' because it has no upstream tracking branch.`
      );
    }

    const localHeadAlreadyPushed = await isAncestor(input.workspacePath, "HEAD", upstream);

    if (!localHeadAlreadyPushed) {
      throw new Error(
        `Cannot recover PR update for branch '${input.branchName}' because local HEAD is not present on upstream '${upstream}'.`
      );
    }
  }

  return { upstream };
}

async function assertPushWouldNotHideRemoteCommits(input: {
  workspacePath: string;
  branchName: string;
  upstream?: string;
}): Promise<void> {
  if (!input.upstream) {
    return;
  }

  const divergence = await getBranchDivergence(input.workspacePath, input.upstream);

  if (divergence.behind > 0) {
    throw new Error(
      `Cannot push branch '${input.branchName}' because upstream '${input.upstream}' has ${divergence.behind} commit(s) not present locally.`
    );
  }
}

async function editExistingPullRequest(input: {
  runner: PullRequestCommandRunner;
  workspacePath: string;
  prUrl: string;
  title: string;
  body: string;
}): Promise<void> {
  await input.runner.gh(["pr", "edit", input.prUrl, "--title", input.title, "--body", input.body], input.workspacePath);
}

async function assertPullRequestMatchesOrigin(input: {
  prUrl: string;
  workspacePath: string;
  runner: PullRequestCommandRunner;
}): Promise<void> {
  const parsedPr = parseGithubPullRequestUrl(input.prUrl);
  const remote = await input.runner.git(["remote", "get-url", "origin"], input.workspacePath);
  const parsedRemote = parseGithubRemoteUrl(remote.stdout.trim());

  if (!parsedRemote) {
    throw new Error("Could not determine a GitHub origin remote for PR validation.");
  }

  if (parsedPr.host !== parsedRemote.host || parsedPr.owner !== parsedRemote.owner || parsedPr.repo !== parsedRemote.repo) {
    throw new Error("Pull request URL does not match this worktree's origin remote.");
  }
}

function parseGithubPullRequestUrl(value: string): { host: string; owner: string; repo: string; number: string } {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Pull request URL must be an https GitHub pull request URL.");
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (url.protocol !== "https:" || parts.length !== 4 || parts[2] !== "pull" || !/^\d+$/u.test(parts[3] ?? "")) {
    throw new Error("Pull request URL must be an https GitHub pull request URL.");
  }

  return {
    host: url.hostname.toLowerCase(),
    owner: parts[0]?.toLowerCase() ?? "",
    repo: normalizeRepoName(parts[1] ?? ""),
    number: parts[3] ?? ""
  };
}

function parseGithubRemoteUrl(value: string): { host: string; owner: string; repo: string } | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const sshMatch = trimmed.match(/^(?:ssh:\/\/)?git@([^/:]+)[:/]([^/]+)\/(.+?)(?:\.git)?$/u);

  if (sshMatch) {
    return {
      host: sshMatch[1]?.toLowerCase() ?? "",
      owner: sshMatch[2]?.toLowerCase() ?? "",
      repo: normalizeRepoName(sshMatch[3] ?? "")
    };
  }

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);

    if (!["https:", "http:", "ssh:"].includes(url.protocol) || parts.length < 2) {
      return undefined;
    }

    return {
      host: url.hostname.toLowerCase(),
      owner: parts[0]?.toLowerCase() ?? "",
      repo: normalizeRepoName(parts[1] ?? "")
    };
  } catch {
    return undefined;
  }
}

function normalizeRepoName(value: string): string {
  return value.replace(/\.git$/iu, "").toLowerCase();
}

function assertPullRequestStatusMatchesBranch(status: DraftPullRequestStatus, branchName: string): void {
  if (status.headRefName && status.headRefName !== branchName) {
    throw new Error(`Pull request branch '${status.headRefName}' does not match expected branch '${branchName}'.`);
  }
}

function assertPullRequestIsOpen(status: DraftPullRequestStatus): void {
  if (status.state && status.state.toUpperCase() !== "OPEN") {
    throw new Error(`Pull request must be open before marking ready for review. Current state: ${status.state}.`);
  }
}

function normalizeCheckRollup(value: unknown): { details: DraftPullRequestCheckDetail[] } {
  const records = collectCheckRecords(value);
  return {
    details: records.map((record) => normalizeCheckRecord(record))
  };
}

function collectCheckRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCheckRecords(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  const nested = [
    value.nodes,
    value.contexts,
    value.checkRuns,
    value.checkSuites,
    value.statusCheckRollup
  ].flatMap((item) => collectCheckRecords(item));

  if (nested.length > 0) {
    return nested;
  }

  return hasCheckLikeFields(value) ? [value] : [];
}

function hasCheckLikeFields(value: Record<string, unknown>): boolean {
  return [
    value.name,
    value.context,
    value.checkName,
    value.workflowName,
    value.title,
    value.status,
    value.state,
    value.conclusion,
    value.detailsUrl,
    value.targetUrl,
    value.url
  ].some((field) => typeof field === "string" && field.trim().length > 0);
}

function normalizeCheckRecord(record: Record<string, unknown>): DraftPullRequestCheckDetail {
  const name =
    stringField(record.name) ??
    stringField(record.context) ??
    stringField(record.checkName) ??
    stringField(record.title) ??
    stringField(record.workflowName) ??
    "Unnamed check";
  const status = stringField(record.status) ?? stringField(record.state);
  const conclusion = stringField(record.conclusion);
  const workflowName = stringField(record.workflowName);
  const url = safeHttpsUrl(
    stringField(record.detailsUrl) ??
      stringField(record.targetUrl) ??
      stringField(record.url) ??
      stringField(record.permalink)
  );

  return {
    name,
    state: classifyCheckState({ status, conclusion }),
    ...(status ? { status } : {}),
    ...(conclusion ? { conclusion } : {}),
    ...(workflowName && workflowName !== name ? { workflowName } : {}),
    ...(url ? { url } : {})
  };
}

function classifyCheckState(input: { status?: string; conclusion?: string }): DraftPullRequestCheckState {
  const conclusion = input.conclusion?.toUpperCase();
  const status = input.status?.toUpperCase();

  if (["SUCCESS", "PASSED"].includes(conclusion ?? "")) {
    return "passed";
  }

  if (["NEUTRAL", "SKIPPED"].includes(conclusion ?? "")) {
    return "skipped";
  }

  if (["FAILURE", "FAILED", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(conclusion ?? "")) {
    return "failed";
  }

  if (["SUCCESS", "PASSED"].includes(status ?? "")) {
    return "passed";
  }

  if (["FAILURE", "FAILED", "ERROR"].includes(status ?? "")) {
    return "failed";
  }

  if (status === "COMPLETED" && !conclusion) {
    return "failed";
  }

  if (["PENDING", "EXPECTED", "IN_PROGRESS", "QUEUED", "REQUESTED", "WAITING"].includes(status ?? "")) {
    return "pending";
  }

  return conclusion || status ? "unknown" : "pending";
}

function summarizeChecks(checks: DraftPullRequestCheckDetail[]): { total: number; passed: number; failed: number; pending: number } {
  let passed = 0;
  let failed = 0;
  let pending = 0;

  for (const check of checks) {
    if (check.state === "passed" || check.state === "skipped") {
      passed += 1;
    } else if (check.state === "failed" || check.state === "unknown") {
      failed += 1;
    } else {
      pending += 1;
    }
  }

  return { total: checks.length, passed, failed, pending };
}

function formatChecksSummary(counts: { total: number; passed: number; failed: number; pending: number }): string {
  if (counts.total === 0) {
    return "No status checks reported.";
  }

  if (counts.failed === 0 && counts.pending === 0) {
    return `All ${counts.total} status check(s) passed.`;
  }

  return `${counts.passed}/${counts.total} passed, ${counts.failed} failed, ${counts.pending} pending.`;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (/[<>|]/u.test(value)) {
    return undefined;
  }

  try {
    const url = new URL(value);
    const normalized = url.toString();
    return url.protocol === "https:" && !/[<>|]/u.test(normalized) ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncateSingleLine(value: string, max: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();

  if (singleLine.length <= max) {
    return singleLine;
  }

  return singleLine.slice(0, max - 1).trimEnd();
}

function cleanSummaryLine(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\((?:\/|[A-Za-z]:)[^)]+\)/g, "$1")
    .replace(/^[#*\-\s`]+/, "")
    .replace(/[*`#\s]+$/g, "")
    .trim();
}

function isSectionHeading(line: string): boolean {
  return /^(summary|proposed edits?|tests?|risks?|approval notes?)$/i.test(line.trim());
}

function sanitizeSummaryForPullRequest(summary: string): string {
  const sanitizedLines = summary
    .replace(/\[([^\]]+)\]\((?:\/|[A-Za-z]:)[^)]+\)/g, "`$1`")
    .split(/\r?\n/);
  const firstContentIndex = sanitizedLines.findIndex((line) => line.trim().length > 0);

  if (firstContentIndex >= 0 && cleanSummaryLine(sanitizedLines[firstContentIndex]).toLowerCase() === "summary") {
    sanitizedLines.splice(firstContentIndex, 1);
  }

  return sanitizedLines.join("\n").trim();
}

function escapeMarkdownCodeSpan(value: string): string {
  return value.replace(/`/g, "'");
}
