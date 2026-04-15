import { nanoid } from "nanoid";
import type { RepoBinding, Session, SlackTaskContext } from "../../../packages/shared/src/types.js";
import { slackThreadKey } from "../../../packages/shared/src/types.js";
import type { InMemoryStore } from "./persistence/inMemory.js";

export function getOrCreateSession(input: {
  store: InMemoryStore;
  slack: SlackTaskContext;
  repo: RepoBinding;
  workspacePath?: string;
  sourceRepoPath?: string;
}): Session {
  const threadKey = slackThreadKey(input.slack.thread);
  const existing = input.store.getSessionByThread(threadKey);
  const now = new Date().toISOString();

  if (existing) {
    return existing;
  }

  const id = nanoid(12);
  const session: Session = {
    id,
    slackThreadKey: threadKey,
    ownerSlackUserId: input.slack.requestingUserId,
    repoId: input.repo.id,
    sourceRepoPath: input.sourceRepoPath ?? input.repo.path,
    workspacePath: input.workspacePath ?? "",
    branchName: buildBranchName(input.slack.thread.threadTs, id),
    runnerKind: "exec",
    status: "idle",
    createdAt: now,
    updatedAt: now
  };

  input.store.saveSession(session);
  return session;
}

export function touchSession(session: Session, status: Session["status"]): Session {
  session.status = status;
  session.updatedAt = new Date().toISOString();
  return session;
}

function buildBranchName(threadTs: string, sessionId: string): string {
  const safeThread = threadTs.replace(/[^0-9A-Za-z._-]/g, "-").slice(0, 24);
  return `codex/slack/${safeThread}-${sessionId.slice(0, 8)}`;
}
