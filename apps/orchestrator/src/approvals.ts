import { nanoid } from "nanoid";
import type { ApprovalRequest, ApprovalType, TaskRun } from "../../../packages/shared/src/types.js";

export function createExecutionApproval(input: {
  taskRun: TaskRun;
  requestedBySlackUserId: string;
  summary: string;
  type?: ApprovalType;
  ttlMinutes?: number;
}): ApprovalRequest {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMinutes ?? 60) * 60 * 1000);

  return {
    id: nanoid(12),
    taskRunId: input.taskRun.id,
    sessionId: input.taskRun.sessionId,
    requestedBySlackUserId: input.requestedBySlackUserId,
    type: input.type ?? "execute_plan",
    summary: input.summary,
    expiresAt: expiresAt.toISOString(),
    status: "pending",
    createdAt: now.toISOString()
  };
}

export function isExpired(approval: ApprovalRequest): boolean {
  return Date.parse(approval.expiresAt) <= Date.now();
}
