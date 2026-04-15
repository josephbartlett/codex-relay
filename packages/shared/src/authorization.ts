import type { HarnessConfig } from "./config.js";

export type AuthorizationAction =
  | "start_task"
  | "approve_execution"
  | "cancel_task"
  | "open_details"
  | "create_pr"
  | "ready_for_review"
  | "cleanup"
  | "status"
  | "audit";

export interface AuthorizationInput {
  action: AuthorizationAction;
  slackUserId: string;
  slackChannelId?: string;
  repoId?: string;
}

export interface AuthorizationResult {
  ok: boolean;
  reason?:
    | "user_not_allowed"
    | "channel_required"
    | "channel_not_allowed"
    | "repo_policy_required"
    | "repo_user_not_allowed"
    | "repo_channel_not_allowed";
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly result: AuthorizationResult
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function authorizeSlackAction(config: HarnessConfig, input: AuthorizationInput): AuthorizationResult {
  const isMaintainer = isSlackMaintainer(config, input.slackUserId);
  const strict = config.policy.mode === "strict";
  const repoPolicy = input.repoId ? config.policy.repoPolicies[input.repoId] : undefined;

  if (input.repoId && !repoPolicy && strict) {
    return { ok: false, reason: "repo_policy_required" };
  }

  if (!isMaintainer) {
    const globalUserAllowed = isAllowedByList(input.slackUserId, config.policy.allowedSlackUserIds);
    const repoUserAllowed = repoPolicy
      ? isAllowedByList(input.slackUserId, repoPolicy.allowedSlackUserIds)
      : false;

    if (strict) {
      if (input.repoId) {
        if (hasEntries(config.policy.allowedSlackUserIds) && !globalUserAllowed) {
          return { ok: false, reason: "user_not_allowed" };
        }

        if (!hasEntries(repoPolicy?.allowedSlackUserIds ?? []) || !repoUserAllowed) {
          return { ok: false, reason: "repo_user_not_allowed" };
        }
      } else if (
        !globalUserAllowed &&
        !isAllowedByAnyRepoPolicy(input.slackUserId, config.policy.repoPolicies, "users")
      ) {
        return { ok: false, reason: "user_not_allowed" };
      }
    } else {
      if (hasEntries(config.policy.allowedSlackUserIds) && !globalUserAllowed) {
        return { ok: false, reason: "user_not_allowed" };
      }

      if (repoPolicy && hasEntries(repoPolicy.allowedSlackUserIds) && !repoUserAllowed) {
        return { ok: false, reason: "repo_user_not_allowed" };
      }
    }
  }

  if (!requiresChannel(input.action)) {
    return { ok: true };
  }

  if (!input.slackChannelId) {
    return { ok: false, reason: "channel_required" };
  }

  const globalChannelAllowed = isAllowedByList(input.slackChannelId, config.policy.allowedSlackChannelIds);
  const repoChannelAllowed = repoPolicy
    ? isAllowedByList(input.slackChannelId, repoPolicy.allowedSlackChannelIds)
    : false;

  if (strict) {
    if (input.repoId) {
      if (hasEntries(config.policy.allowedSlackChannelIds) && !globalChannelAllowed) {
        return { ok: false, reason: "channel_not_allowed" };
      }

      if (!hasEntries(repoPolicy?.allowedSlackChannelIds ?? []) || !repoChannelAllowed) {
        return { ok: false, reason: "repo_channel_not_allowed" };
      }
    } else if (
      !globalChannelAllowed &&
      !isAllowedByAnyRepoPolicy(input.slackChannelId, config.policy.repoPolicies, "channels")
    ) {
      return { ok: false, reason: "channel_not_allowed" };
    }
  } else {
    if (hasEntries(config.policy.allowedSlackChannelIds) && !globalChannelAllowed) {
      return { ok: false, reason: "channel_not_allowed" };
    }

    if (repoPolicy && hasEntries(repoPolicy.allowedSlackChannelIds) && !repoChannelAllowed) {
      return { ok: false, reason: "repo_channel_not_allowed" };
    }
  }

  return { ok: true };
}

export function isSlackMaintainer(config: HarnessConfig, slackUserId: string): boolean {
  return config.policy.maintainerSlackUserIds.includes(slackUserId);
}

export function assertAuthorizedSlackAction(config: HarnessConfig, input: AuthorizationInput): void {
  const result = authorizeSlackAction(config, input);

  if (!result.ok) {
    throw new AuthorizationError("You are not authorized to use Codex Relay for this Slack user, channel, or repo.", result);
  }
}

function requiresChannel(action: AuthorizationAction): boolean {
  return [
    "start_task",
    "approve_execution",
    "cancel_task",
    "open_details",
    "create_pr",
    "ready_for_review",
    "cleanup",
    "status",
    "audit"
  ].includes(action);
}

function isAllowedByList(value: string, allowlist: string[]): boolean {
  return allowlist.includes(value);
}

function hasEntries(values: string[]): boolean {
  return values.length > 0;
}

function isAllowedByAnyRepoPolicy(
  value: string,
  policies: HarnessConfig["policy"]["repoPolicies"],
  kind: "users" | "channels"
): boolean {
  return Object.values(policies).some((policy) =>
    kind === "users"
      ? isAllowedByList(value, policy.allowedSlackUserIds)
      : isAllowedByList(value, policy.allowedSlackChannelIds)
  );
}
