#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

const options = parseArgs(process.argv.slice(2));
const envFile = resolve(options.envFile ?? ".env");
const failures = [];
const warnings = [];
const ok = [];

run();

function run() {
  const env = loadEnvFile(envFile);

  if (env) {
    validateEnv(env);
  }

  printReport();

  if (failures.length > 0) {
    process.exit(1);
  }
}

function loadEnvFile(path) {
  if (!existsSync(path)) {
    failures.push("Local env file is missing.");
    return undefined;
  }

  try {
    const parsed = parse(readFileSync(path, "utf8"));
    ok.push("Local env file is readable.");
    return parsed;
  } catch (error) {
    failures.push(`Local env file could not be parsed: ${error instanceof Error ? error.message : "unknown error"}.`);
    return undefined;
  }
}

function validateEnv(env) {
  for (const key of ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"]) {
    if (!hasValue(env[key]) || isPlaceholder(env[key])) {
      failures.push(`${key} must be set to a non-placeholder value.`);
    }
  }

  if (hasValue(env.SLACK_SIGNING_SECRET) && isPlaceholder(env.SLACK_SIGNING_SECRET)) {
    failures.push("SLACK_SIGNING_SECRET must not use a placeholder value.");
  } else if (!hasValue(env.SLACK_SIGNING_SECRET)) {
    warnings.push("SLACK_SIGNING_SECRET is empty; this is acceptable for Socket Mode-only local use, but HTTP endpoints require it.");
  }

  const config = parseHarnessConfig(env);

  if (!config) {
    return;
  }

  ok.push("Harness config parses successfully.");

  if (config.policy.mode !== "strict") {
    failures.push("CODEX_POLICY_MODE must be strict for release-ready live operation.");
  } else {
    ok.push("Strict policy mode is configured.");
  }

  if (config.policy.allowedSlackUserIds.length === 0) {
    failures.push("CODEX_ALLOWED_SLACK_USERS must include at least one Slack user ID.");
  }

  if (config.policy.allowedSlackChannelIds.length === 0) {
    failures.push("CODEX_ALLOWED_SLACK_CHANNELS must include at least one Slack channel ID.");
  }

  if (config.policy.allowedSlackUserIds.some((id) => !isSlackUserId(id))) {
    failures.push("CODEX_ALLOWED_SLACK_USERS contains an invalid Slack user ID shape.");
  }

  if (config.policy.maintainerSlackUserIds.some((id) => !isSlackUserId(id))) {
    failures.push("CODEX_MAINTAINER_SLACK_USERS contains an invalid Slack user ID shape.");
  }

  if (config.policy.allowedSlackChannelIds.some((id) => !isSlackChannelId(id))) {
    failures.push("CODEX_ALLOWED_SLACK_CHANNELS contains an invalid Slack channel ID shape.");
  }

  validateRepoPolicies(config);
  validateRepoBindings(config);

  if (failures.length === 0) {
    ok.push("Live config is ready for strict-mode Slack operation.");
  }
}

function validateRepoPolicies(config) {
  for (const repo of config.repos) {
    const policy = config.policy.repoPolicies[repo.id];

    if (!policy) {
      failures.push(`Repo '${repo.id}' must have repo-specific Slack user and channel policy.`);
      continue;
    }

    if (policy.allowedSlackUserIds.length === 0) {
      failures.push(`Repo '${repo.id}' must have at least one repo-specific Slack user ID.`);
    }

    if (policy.allowedSlackChannelIds.length === 0) {
      failures.push(`Repo '${repo.id}' must have at least one repo-specific Slack channel ID.`);
    }

    if (policy.allowedSlackUserIds.some((id) => !isSlackUserId(id))) {
      failures.push(`Repo '${repo.id}' contains an invalid repo-specific Slack user ID shape.`);
    }

    if (policy.allowedSlackChannelIds.some((id) => !isSlackChannelId(id))) {
      failures.push(`Repo '${repo.id}' contains an invalid repo-specific Slack channel ID shape.`);
    }
  }
}

function validateRepoBindings(config) {
  for (const repo of config.repos) {
    if (isPlaceholder(repo.path)) {
      failures.push(`Repo '${repo.id}' path must not use a placeholder value.`);
      continue;
    }

    if (!existsSync(repo.path)) {
      failures.push(`Repo '${repo.id}' path must exist.`);
      continue;
    }

    try {
      execFileSync("git", ["-C", repo.path, "rev-parse", "--is-inside-work-tree"], {
        encoding: "utf8",
        stdio: "pipe",
        timeout: 10_000
      });
      ok.push(`Repo '${repo.id}' path is a git worktree.`);
    } catch {
      failures.push(`Repo '${repo.id}' path must be a git worktree.`);
    }
  }
}

function parseHarnessConfig(env) {
  const repos = parseRepoBindings(env.CODEX_ALLOWED_REPOS || "default=.");
  const defaultRepoId = env.CODEX_DEFAULT_REPO_ID?.trim() || repos[0]?.id;

  if (repos.length === 0 || !defaultRepoId) {
    failures.push("At least one CODEX_ALLOWED_REPOS binding is required.");
    return undefined;
  }

  if (!repos.some((repo) => repo.id === defaultRepoId)) {
    failures.push("CODEX_DEFAULT_REPO_ID must reference a configured repo.");
    return undefined;
  }

  const repoPolicies = mergeRepoPolicies(
    parseRepoPolicyMap(env.CODEX_REPO_ALLOWED_SLACK_USERS || "", "users"),
    parseRepoPolicyMap(env.CODEX_REPO_ALLOWED_SLACK_CHANNELS || "", "channels")
  );
  const configuredRepoIds = new Set(repos.map((repo) => repo.id));
  const unknownRepoIds = Object.keys(repoPolicies).filter((repoId) => !configuredRepoIds.has(repoId));

  if (unknownRepoIds.length > 0) {
    failures.push("Repo policy references an unknown repo ID.");
    return undefined;
  }

  return {
    repos,
    defaultRepoId,
    policy: {
      mode: env.CODEX_POLICY_MODE?.trim() || "strict",
      allowedSlackUserIds: parseList(env.CODEX_ALLOWED_SLACK_USERS || ""),
      maintainerSlackUserIds: parseList(env.CODEX_MAINTAINER_SLACK_USERS || ""),
      allowedSlackChannelIds: parseList(env.CODEX_ALLOWED_SLACK_CHANNELS || ""),
      repoPolicies
    }
  };
}

function parseRepoBindings(raw) {
  const repos = [];

  for (const entry of raw.split(/[,\n;]/u).map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");

    if (separator === -1) {
      failures.push("CODEX_ALLOWED_REPOS contains an invalid repo binding.");
      continue;
    }

    const id = entry.slice(0, separator).trim();
    const path = entry.slice(separator + 1).trim();

    if (!id || !path) {
      failures.push("CODEX_ALLOWED_REPOS contains an incomplete repo binding.");
      continue;
    }

    repos.push({ id, path: resolve(path) });
  }

  return repos;
}

function parseList(raw) {
  return raw
    .split(/[,\n;\s]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseRepoPolicyMap(raw, kind) {
  const policies = {};

  for (const entry of raw.split(/[,\n;]/u).map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");

    if (separator === -1) {
      failures.push(`CODEX_REPO_ALLOWED_SLACK_${kind.toUpperCase()} contains an invalid policy entry.`);
      continue;
    }

    const repoId = entry.slice(0, separator).trim();
    const values = entry
      .slice(separator + 1)
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!repoId) {
      failures.push(`CODEX_REPO_ALLOWED_SLACK_${kind.toUpperCase()} contains an entry without a repo ID.`);
      continue;
    }

    policies[repoId] = {
      allowedSlackUserIds: kind === "users" ? values : [],
      allowedSlackChannelIds: kind === "channels" ? values : []
    };
  }

  return policies;
}

function mergeRepoPolicies(users, channels) {
  const merged = {};
  const repoIds = new Set([...Object.keys(users), ...Object.keys(channels)]);

  for (const repoId of repoIds) {
    merged[repoId] = {
      allowedSlackUserIds: users[repoId]?.allowedSlackUserIds ?? [],
      allowedSlackChannelIds: channels[repoId]?.allowedSlackChannelIds ?? []
    };
  }

  return merged;
}

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--env-file") {
      const value = args[index + 1];

      if (!value) {
        throw new Error("--env-file requires a path.");
      }

      parsed.envFile = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printReport() {
  console.log("Codex Relay live config validation");

  if (ok.length > 0) {
    console.log("\nOK:");
    for (const message of ok) {
      console.log(`- ${message}`);
    }
  }

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const message of warnings) {
      console.log(`- ${message}`);
    }
  }

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const message of failures) {
      console.log(`- ${message}`);
    }
    return;
  }

  console.log("\nLive config passed.");
}

function hasValue(value) {
  return Boolean(value?.trim());
}

function isPlaceholder(value) {
  const normalized = value?.trim().toLowerCase() ?? "";

  return (
    normalized === "" ||
    normalized.includes("your-") ||
    normalized.includes("placeholder") ||
    normalized.includes("/absolute/path") ||
    normalized === "u1234567890" ||
    normalized === "c1234567890"
  );
}

function isSlackUserId(value) {
  return /^[UW][A-Z0-9]{2,}$/u.test(value);
}

function isSlackChannelId(value) {
  return /^[CGD][A-Z0-9]{2,}$/u.test(value);
}
