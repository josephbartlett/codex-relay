import "dotenv/config";

import { resolve } from "node:path";
import { z } from "zod";
import type { RepoBinding } from "./types.js";

const EnvSchema = z.object({
  SLACK_BOT_TOKEN: z.string().optional().default(""),
  SLACK_APP_TOKEN: z.string().optional().default(""),
  SLACK_SIGNING_SECRET: z.string().optional().default(""),
  CODEX_ALLOWED_REPOS: z.string().default("default=."),
  CODEX_DEFAULT_REPO_ID: z.string().optional(),
  CODEX_WORKTREE_ROOT: z.string().default(".codex-slack/worktrees"),
  CODEX_STATE_PATH: z.string().default(".codex-slack/state.json"),
  CODEX_COMMAND: z.string().default("codex"),
  CODEX_MODEL: z.string().optional().default(""),
  CODEX_RUNNER_ENV_ALLOWLIST: z
    .string()
    .default("PATH,HOME,USER,USERNAME,SHELL,TMPDIR,TMP,TEMP,LANG,LC_ALL,TERM,NO_COLOR,CODEX_HOME"),
  CODEX_PROFILES_PATH: z.string().default("infra/codex/profiles.toml"),
  CODEX_RULES_PATH: z.string().default("infra/codex/default.rules"),
  CODEX_REQUIRE_EXECPOLICY_CHECK: z.enum(["true", "false"]).default("true"),
  CODEX_STORE_KIND: z.enum(["json", "sqlite"]).default("json"),
  CODEX_DATABASE_PATH: z.string().default(".codex-slack/state.db"),
  CODEX_POLICY_MODE: z.enum(["strict", "local-dev"]).default("strict"),
  CODEX_ALLOWED_SLACK_USERS: z.string().default(""),
  CODEX_MAINTAINER_SLACK_USERS: z.string().default(""),
  CODEX_ALLOWED_SLACK_CHANNELS: z.string().default(""),
  CODEX_REPO_ALLOWED_SLACK_USERS: z.string().default(""),
  CODEX_REPO_ALLOWED_SLACK_CHANNELS: z.string().default("")
});

export interface LoadConfigOptions {
  requireSlack?: boolean;
}

export interface HarnessConfig {
  slack: {
    botToken: string;
    appToken: string;
    signingSecret: string;
  };
  codex: {
    command: string;
    model?: string;
    worktreeRoot: string;
    statePath: string;
    runnerEnvAllowlist: string[];
    profilesPath: string;
    rulesPath: string;
    requireExecPolicyCheck: boolean;
    storeKind: "json" | "sqlite";
    databasePath: string;
  };
  repos: RepoBinding[];
  defaultRepoId: string;
  policy: HarnessPolicyConfig;
}

export interface HarnessPolicyConfig {
  mode: "strict" | "local-dev";
  allowedSlackUserIds: string[];
  maintainerSlackUserIds: string[];
  allowedSlackChannelIds: string[];
  repoPolicies: Record<string, RepoPolicyConfig>;
}

export interface RepoPolicyConfig {
  allowedSlackUserIds: string[];
  allowedSlackChannelIds: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: LoadConfigOptions = {}): HarnessConfig {
  const parsed = EnvSchema.parse(env);
  const requireSlack = options.requireSlack ?? true;

  if (requireSlack && (!parsed.SLACK_BOT_TOKEN || !parsed.SLACK_APP_TOKEN)) {
    throw new Error("SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required.");
  }

  const repos = parseRepoBindings(parsed.CODEX_ALLOWED_REPOS);
  const defaultRepoId = parsed.CODEX_DEFAULT_REPO_ID ?? repos[0]?.id;
  const repoPolicies = mergeRepoPolicies(
    parseRepoPolicyMap(parsed.CODEX_REPO_ALLOWED_SLACK_USERS, "users"),
    parseRepoPolicyMap(parsed.CODEX_REPO_ALLOWED_SLACK_CHANNELS, "channels")
  );

  if (!defaultRepoId) {
    throw new Error("At least one CODEX_ALLOWED_REPOS binding is required.");
  }

  if (!repos.some((repo) => repo.id === defaultRepoId)) {
    throw new Error(`CODEX_DEFAULT_REPO_ID '${defaultRepoId}' is not in CODEX_ALLOWED_REPOS.`);
  }

  assertRepoPoliciesReferenceConfiguredRepos(repos, repoPolicies);

  return {
    slack: {
      botToken: parsed.SLACK_BOT_TOKEN,
      appToken: parsed.SLACK_APP_TOKEN,
      signingSecret: parsed.SLACK_SIGNING_SECRET
    },
    codex: {
      command: parsed.CODEX_COMMAND,
      model: parsed.CODEX_MODEL || undefined,
      worktreeRoot: resolve(parsed.CODEX_WORKTREE_ROOT),
      statePath: resolve(parsed.CODEX_STATE_PATH),
      runnerEnvAllowlist: parseList(parsed.CODEX_RUNNER_ENV_ALLOWLIST),
      profilesPath: resolve(parsed.CODEX_PROFILES_PATH),
      rulesPath: resolve(parsed.CODEX_RULES_PATH),
      requireExecPolicyCheck: parsed.CODEX_REQUIRE_EXECPOLICY_CHECK === "true",
      storeKind: parsed.CODEX_STORE_KIND,
      databasePath: resolve(parsed.CODEX_DATABASE_PATH)
    },
    repos,
    defaultRepoId,
    policy: {
      mode: parsed.CODEX_POLICY_MODE,
      allowedSlackUserIds: parseList(parsed.CODEX_ALLOWED_SLACK_USERS),
      maintainerSlackUserIds: parseList(parsed.CODEX_MAINTAINER_SLACK_USERS),
      allowedSlackChannelIds: parseList(parsed.CODEX_ALLOWED_SLACK_CHANNELS),
      repoPolicies
    }
  };
}

export function parseRepoBindings(raw: string): RepoBinding[] {
  return raw
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");

      if (separator === -1) {
        throw new Error(`Invalid repo binding '${entry}'. Expected id=/absolute/path.`);
      }

      const id = entry.slice(0, separator).trim();
      const path = entry.slice(separator + 1).trim();

      if (!id || !path) {
        throw new Error(`Invalid repo binding '${entry}'. Expected id=/absolute/path.`);
      }

      return { id, path: resolve(path) };
    });
}

export function resolveRepoBinding(config: HarnessConfig, requestedRepoId?: string): RepoBinding {
  const repoId = requestedRepoId ?? config.defaultRepoId;
  const repo = config.repos.find((binding) => binding.id === repoId);

  if (!repo) {
    throw new Error(`Repo '${repoId}' is not configured in CODEX_ALLOWED_REPOS.`);
  }

  return repo;
}

function parseList(raw: string): string[] {
  return raw
    .split(/[,\n;\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseRepoPolicyMap(raw: string, kind: "users" | "channels"): Record<string, RepoPolicyConfig> {
  const policies: Record<string, RepoPolicyConfig> = {};

  for (const entry of raw.split(/[,\n;]/).map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");

    if (separator === -1) {
      throw new Error(`Invalid repo Slack ${kind} policy '${entry}'. Expected repo=id1|id2.`);
    }

    const repoId = entry.slice(0, separator).trim();
    const values = entry
      .slice(separator + 1)
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!repoId) {
      throw new Error(`Invalid repo Slack ${kind} policy '${entry}'. Repo id is required.`);
    }

    policies[repoId] = {
      allowedSlackUserIds: kind === "users" ? values : [],
      allowedSlackChannelIds: kind === "channels" ? values : []
    };
  }

  return policies;
}

function mergeRepoPolicies(
  users: Record<string, RepoPolicyConfig>,
  channels: Record<string, RepoPolicyConfig>
): Record<string, RepoPolicyConfig> {
  const merged: Record<string, RepoPolicyConfig> = {};
  const repoIds = new Set([...Object.keys(users), ...Object.keys(channels)]);

  for (const repoId of repoIds) {
    merged[repoId] = {
      allowedSlackUserIds: users[repoId]?.allowedSlackUserIds ?? [],
      allowedSlackChannelIds: channels[repoId]?.allowedSlackChannelIds ?? []
    };
  }

  return merged;
}

function assertRepoPoliciesReferenceConfiguredRepos(
  repos: RepoBinding[],
  repoPolicies: Record<string, RepoPolicyConfig>
): void {
  const repoIds = new Set(repos.map((repo) => repo.id));
  const unknownRepoIds = Object.keys(repoPolicies).filter((repoId) => !repoIds.has(repoId));

  if (unknownRepoIds.length > 0) {
    throw new Error(`Repo policy references unknown repo id(s): ${unknownRepoIds.join(", ")}.`);
  }
}
