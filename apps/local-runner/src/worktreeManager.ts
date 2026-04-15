import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RepoBinding } from "../../../packages/shared/src/types.js";
import { assertGitRepo, runGit } from "./git.js";

export interface WorktreeRequest {
  sessionId: string;
  repo: RepoBinding;
  branchName: string;
}

export interface WorktreeResult {
  sourceRepoPath: string;
  workspacePath: string;
  branchName: string;
}

export class WorktreeManager {
  constructor(private readonly worktreeRoot: string) {}

  async createWorktree(request: WorktreeRequest): Promise<WorktreeResult> {
    const sourceRepoPath = await assertGitRepo(request.repo.path);
    await mkdir(this.worktreeRoot, { recursive: true });

    const worktreePath = join(this.worktreeRoot, sanitizePathSegment(request.sessionId));
    await runGit(["worktree", "add", "-b", request.branchName, worktreePath, "HEAD"], sourceRepoPath);

    return {
      sourceRepoPath,
      workspacePath: worktreePath,
      branchName: request.branchName
    };
  }

  async removeWorktree(sourceRepoPath: string, workspacePath: string): Promise<void> {
    await runGit(["worktree", "remove", workspacePath], sourceRepoPath);
  }
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
}
