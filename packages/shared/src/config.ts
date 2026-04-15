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
  CODEX_DIRECT_WORKSPACE_ENABLED: z.enum(["true", "false"]).default("false"),
  CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS: z.string().default(""),
  CODEX_DIRECT_WORKSPACE_REQUIRE_CLEAN: z.enum(["true", "false"]).default("true"),
  CODEX_POLICY_MODE: z.enum(["strict", "local-dev"]).default("strict"),
  CODEX_ALLOWED_SLACK_USERS: z.string().default(""),
  CODEX_MAINTAINER_SLACK_USERS: z.string().default(""),
  CODEX_ALLOWED_SLACK_CHANNELS: z.string().default(""),
  CODEX_REPO_ALLOWED_SLACK_USERS: z.string().default(""),
  CODEX_REPO_ALLOWED_SLACK_CHANNELS: z.string().default(""),
  EMAIL_CONTROL_PLANE_ENABLED: z.enum(["true", "false"]).default("false"),
  EMAIL_ALLOWED_SENDERS: z.string().default(""),
  EMAIL_MAILBOX_ID: z.string().default("default"),
  EMAIL_DEFAULT_REPO_ID: z.string().optional().default(""),
  EMAIL_DIRECT_WORKSPACE_ENABLED: z.enum(["true", "false"]).default("false"),
  EMAIL_IMAP_ENABLED: z.enum(["true", "false"]).default("false"),
  EMAIL_IMAP_HOST: z.string().optional().default(""),
  EMAIL_IMAP_PORT: z.string().optional().default("993"),
  EMAIL_IMAP_SECURE: z.enum(["true", "false"]).default("true"),
  EMAIL_IMAP_TLS_REJECT_UNAUTHORIZED: z.enum(["true", "false"]).default("true"),
  EMAIL_IMAP_USER: z.string().optional().default(""),
  EMAIL_IMAP_PASSWORD: z.string().optional().default(""),
  EMAIL_IMAP_MAILBOX: z.string().optional().default("INBOX"),
  EMAIL_IMAP_POLL_MS: z.string().optional().default("10000"),
  EMAIL_IMAP_MAX_MESSAGES: z.string().optional().default("10"),
  EMAIL_IMAP_MAX_BYTES: z.string().optional().default("200000"),
  EMAIL_IMAP_MARK_SEEN: z.enum(["true", "false"]).default("false"),
  EMAIL_SMTP_ENABLED: z.enum(["true", "false"]).default("false"),
  EMAIL_SMTP_HOST: z.string().optional().default(""),
  EMAIL_SMTP_PORT: z.string().optional().default("587"),
  EMAIL_SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED: z.enum(["true", "false"]).default("true"),
  EMAIL_SMTP_USER: z.string().optional().default(""),
  EMAIL_SMTP_PASSWORD: z.string().optional().default(""),
  EMAIL_FROM: z.string().optional().default(""),
  EMAIL_TO: z.string().optional().default(""),
  EMAIL_PUBLISHER_POLL_MS: z.string().optional().default("2000")
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
    directWorkspace: DirectWorkspaceConfig;
  };
  repos: RepoBinding[];
  defaultRepoId: string;
  policy: HarnessPolicyConfig;
  email?: EmailControlPlaneConfig;
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

export interface EmailControlPlaneConfig {
  enabled: boolean;
  allowedSenders: string[];
  mailboxId: string;
  defaultRepoId?: string;
  directWorkspaceEnabled: boolean;
  imap: EmailImapConfig;
  smtp: EmailSmtpConfig;
}

export interface DirectWorkspaceConfig {
  enabled: boolean;
  allowedRepoIds: string[];
  requireClean: boolean;
}

export const defaultEmailControlPlaneConfig: EmailControlPlaneConfig = {
  enabled: false,
  allowedSenders: [],
  mailboxId: "default",
  defaultRepoId: undefined,
  directWorkspaceEnabled: false,
  imap: {
    enabled: false,
    host: "",
    port: 993,
    secure: true,
    tlsRejectUnauthorized: true,
    username: undefined,
    password: undefined,
    mailbox: "INBOX",
    pollIntervalMs: 10_000,
    maxMessages: 10,
    maxBytes: 200_000,
    markSeen: false
  },
  smtp: {
    enabled: false,
    host: "",
    port: 587,
    secure: false,
    tlsRejectUnauthorized: true,
    username: undefined,
    password: undefined,
    from: "",
    recipients: [],
    pollIntervalMs: 2000
  }
};

export interface EmailImapConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  tlsRejectUnauthorized: boolean;
  username?: string;
  password?: string;
  mailbox: string;
  pollIntervalMs: number;
  maxMessages: number;
  maxBytes: number;
  markSeen: boolean;
}

export interface EmailSmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  tlsRejectUnauthorized: boolean;
  username?: string;
  password?: string;
  from: string;
  recipients: string[];
  pollIntervalMs: number;
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

  const emailAllowedSenders = parseDelimitedList(parsed.EMAIL_ALLOWED_SENDERS).map(normalizeEmailAddress);
  const emailImap = parseEmailImapConfig(parsed);
  const emailSmtp = parseEmailSmtpConfig(parsed);
  const directWorkspace: DirectWorkspaceConfig = {
    enabled: parsed.CODEX_DIRECT_WORKSPACE_ENABLED === "true",
    allowedRepoIds: parseDelimitedList(parsed.CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS),
    requireClean: parsed.CODEX_DIRECT_WORKSPACE_REQUIRE_CLEAN === "true"
  };

  if (emailImap.enabled && emailAllowedSenders.length === 0) {
    throw new Error("EMAIL_ALLOWED_SENDERS must include at least one sender when EMAIL_IMAP_ENABLED=true.");
  }

  if (directWorkspace.enabled && directWorkspace.allowedRepoIds.length === 0) {
    throw new Error("CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS must include at least one repo when CODEX_DIRECT_WORKSPACE_ENABLED=true.");
  }

  assertRepoIdsConfigured(repos, directWorkspace.allowedRepoIds, "CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS");

  if (parsed.EMAIL_DIRECT_WORKSPACE_ENABLED === "true" && !directWorkspace.enabled) {
    throw new Error("CODEX_DIRECT_WORKSPACE_ENABLED=true is required when EMAIL_DIRECT_WORKSPACE_ENABLED=true.");
  }

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
      databasePath: resolve(parsed.CODEX_DATABASE_PATH),
      directWorkspace
    },
    repos,
    defaultRepoId,
    policy: {
      mode: parsed.CODEX_POLICY_MODE,
      allowedSlackUserIds: parseList(parsed.CODEX_ALLOWED_SLACK_USERS),
      maintainerSlackUserIds: parseList(parsed.CODEX_MAINTAINER_SLACK_USERS),
      allowedSlackChannelIds: parseList(parsed.CODEX_ALLOWED_SLACK_CHANNELS),
      repoPolicies
    },
    email: {
      enabled: parsed.EMAIL_CONTROL_PLANE_ENABLED === "true",
      allowedSenders: emailAllowedSenders,
      mailboxId: parsed.EMAIL_MAILBOX_ID,
      defaultRepoId: parsed.EMAIL_DEFAULT_REPO_ID || undefined,
      directWorkspaceEnabled: parsed.EMAIL_DIRECT_WORKSPACE_ENABLED === "true",
      imap: emailImap,
      smtp: emailSmtp
    }
  };
}

export function normalizeEmailAddress(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const angleMatch = trimmed.match(/<([^<>]+)>/u);
  return angleMatch?.[1]?.trim().toLowerCase() ?? trimmed;
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

function parseDelimitedList(raw: string): string[] {
  return raw
    .split(/[,\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseEmailImapConfig(parsed: z.infer<typeof EnvSchema>): EmailImapConfig {
  const port = parseInteger(parsed.EMAIL_IMAP_PORT, "EMAIL_IMAP_PORT", { min: 1, max: 65_535 });
  const pollIntervalMs = parseInteger(parsed.EMAIL_IMAP_POLL_MS, "EMAIL_IMAP_POLL_MS", {
    min: 1_000,
    max: 300_000
  });
  const maxMessages = parseInteger(parsed.EMAIL_IMAP_MAX_MESSAGES, "EMAIL_IMAP_MAX_MESSAGES", {
    min: 1,
    max: 100
  });
  const maxBytes = parseInteger(parsed.EMAIL_IMAP_MAX_BYTES, "EMAIL_IMAP_MAX_BYTES", {
    min: 1_000,
    max: 5_000_000
  });
  const enabled = parsed.EMAIL_IMAP_ENABLED === "true";
  const host = parsed.EMAIL_IMAP_HOST.trim();
  const username = parsed.EMAIL_IMAP_USER.trim() || undefined;
  const password = parsed.EMAIL_IMAP_PASSWORD || undefined;
  const mailbox = parsed.EMAIL_IMAP_MAILBOX.trim() || "INBOX";

  if (enabled) {
    if (parsed.EMAIL_CONTROL_PLANE_ENABLED !== "true") {
      throw new Error("EMAIL_CONTROL_PLANE_ENABLED=true is required when EMAIL_IMAP_ENABLED=true.");
    }

    if (!host) {
      throw new Error("EMAIL_IMAP_HOST is required when EMAIL_IMAP_ENABLED=true.");
    }

    if (Boolean(username) !== Boolean(password)) {
      throw new Error("EMAIL_IMAP_USER and EMAIL_IMAP_PASSWORD must be configured together.");
    }

    if (!username || !password) {
      throw new Error("EMAIL_IMAP_USER and EMAIL_IMAP_PASSWORD are required when EMAIL_IMAP_ENABLED=true.");
    }
  }

  return {
    enabled,
    host,
    port,
    secure: parsed.EMAIL_IMAP_SECURE === "true",
    tlsRejectUnauthorized: parsed.EMAIL_IMAP_TLS_REJECT_UNAUTHORIZED === "true",
    username,
    password,
    mailbox,
    pollIntervalMs,
    maxMessages,
    maxBytes,
    markSeen: parsed.EMAIL_IMAP_MARK_SEEN === "true"
  };
}

function parseEmailSmtpConfig(parsed: z.infer<typeof EnvSchema>): EmailSmtpConfig {
  const port = parseInteger(parsed.EMAIL_SMTP_PORT, "EMAIL_SMTP_PORT", { min: 1, max: 65_535 });
  const pollIntervalMs = parseInteger(parsed.EMAIL_PUBLISHER_POLL_MS, "EMAIL_PUBLISHER_POLL_MS", {
    min: 500,
    max: 300_000
  });
  const recipients = parseDelimitedList(parsed.EMAIL_TO).map(normalizeEmailAddress);
  const enabled = parsed.EMAIL_SMTP_ENABLED === "true";
  const host = parsed.EMAIL_SMTP_HOST.trim();
  const from = parsed.EMAIL_FROM.trim();
  const username = parsed.EMAIL_SMTP_USER.trim() || undefined;
  const password = parsed.EMAIL_SMTP_PASSWORD || undefined;

  if (enabled) {
    if (!host) {
      throw new Error("EMAIL_SMTP_HOST is required when EMAIL_SMTP_ENABLED=true.");
    }

    if (!from) {
      throw new Error("EMAIL_FROM is required when EMAIL_SMTP_ENABLED=true.");
    }

    if (recipients.length === 0) {
      throw new Error("EMAIL_TO must include at least one recipient when EMAIL_SMTP_ENABLED=true.");
    }

    if (Boolean(username) !== Boolean(password)) {
      throw new Error("EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD must be configured together.");
    }
  }

  return {
    enabled,
    host,
    port,
    secure: parsed.EMAIL_SMTP_SECURE === "true",
    tlsRejectUnauthorized: parsed.EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED === "true",
    username,
    password,
    from,
    recipients,
    pollIntervalMs
  };
}

function parseInteger(raw: string, name: string, bounds: { min: number; max: number }): number {
  const value = Number.parseInt(raw, 10);

  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new Error(`${name} must be an integer between ${bounds.min} and ${bounds.max}.`);
  }

  return value;
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
  assertRepoIdsConfigured(repos, Object.keys(repoPolicies), "Repo policy");
}

function assertRepoIdsConfigured(repos: RepoBinding[], repoIds: string[], label: string): void {
  const configuredRepoIds = new Set(repos.map((repo) => repo.id));
  const unknownRepoIds = repoIds.filter((repoId) => !configuredRepoIds.has(repoId));

  if (unknownRepoIds.length > 0) {
    throw new Error(`${label} references unknown repo id(s): ${unknownRepoIds.join(", ")}.`);
  }
}
