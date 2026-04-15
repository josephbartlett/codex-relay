#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { cwd, exit, version as nodeVersion } from "node:process";

const root = cwd();
const failures = [];
const warnings = [];
const ok = [];

const requiredEnvKeys = [
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_SIGNING_SECRET",
  "CODEX_ALLOWED_REPOS",
  "CODEX_DEFAULT_REPO_ID",
  "CODEX_WORKTREE_ROOT",
  "CODEX_STORE_KIND",
  "CODEX_STATE_PATH",
  "CODEX_DATABASE_PATH",
  "CODEX_COMMAND",
  "CODEX_MODEL",
  "CODEX_RUNNER_ENV_ALLOWLIST",
  "CODEX_PROFILES_PATH",
  "CODEX_RULES_PATH",
  "CODEX_REQUIRE_EXECPOLICY_CHECK",
  "CODEX_DIRECT_WORKSPACE_ENABLED",
  "CODEX_DIRECT_WORKSPACE_ALLOWED_REPOS",
  "CODEX_DIRECT_WORKSPACE_REQUIRE_CLEAN",
  "CODEX_POLICY_MODE",
  "CODEX_ALLOWED_SLACK_USERS",
  "CODEX_MAINTAINER_SLACK_USERS",
  "CODEX_ALLOWED_SLACK_CHANNELS",
  "CODEX_REPO_ALLOWED_SLACK_USERS",
  "CODEX_REPO_ALLOWED_SLACK_CHANNELS",
  "AUDIT_VIEWER_HOST",
  "AUDIT_VIEWER_PORT",
  "AUDIT_VIEWER_ALLOW_REMOTE",
  "AUDIT_VIEWER_REQUIRE_AUTH",
  "AUDIT_VIEWER_USERNAME",
  "AUDIT_VIEWER_PASSWORD",
  "EMAIL_CONTROL_PLANE_ENABLED",
  "EMAIL_ALLOWED_SENDERS",
  "EMAIL_MAILBOX_ID",
  "EMAIL_DEFAULT_REPO_ID",
  "EMAIL_DIRECT_WORKSPACE_ENABLED",
  "EMAIL_IMAP_ENABLED",
  "EMAIL_IMAP_HOST",
  "EMAIL_IMAP_PORT",
  "EMAIL_IMAP_SECURE",
  "EMAIL_IMAP_TLS_REJECT_UNAUTHORIZED",
  "EMAIL_IMAP_USER",
  "EMAIL_IMAP_PASSWORD",
  "EMAIL_IMAP_MAILBOX",
  "EMAIL_IMAP_POLL_MS",
  "EMAIL_IMAP_MAX_MESSAGES",
  "EMAIL_IMAP_MAX_BYTES",
  "EMAIL_IMAP_MARK_SEEN",
  "EMAIL_SMTP_ENABLED",
  "EMAIL_SMTP_HOST",
  "EMAIL_SMTP_PORT",
  "EMAIL_SMTP_SECURE",
  "EMAIL_SMTP_TLS_REJECT_UNAUTHORIZED",
  "EMAIL_SMTP_USER",
  "EMAIL_SMTP_PASSWORD",
  "EMAIL_FROM",
  "EMAIL_TO",
  "EMAIL_PUBLISHER_POLL_MS"
];

const forbiddenDefaultEnvNames = [
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_SIGNING_SECRET",
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AZURE_CLIENT_SECRET",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "EMAIL_SMTP_PASSWORD",
  "EMAIL_IMAP_PASSWORD",
  "SSH_AUTH_SOCK"
];

const requiredScripts = [
  "dev:slack",
  "dev:runner",
  "dev:audit",
  "start:slack",
  "start:runner",
  "start:audit",
  "dev:email",
  "start:email",
  "email:test",
  "email:poll",
  "validate:setup",
  "validate:live-config",
  "check",
  "check:secrets",
  "check:release",
  "check:work-packets"
];

run();

function run() {
  checkNodeVersion();
  checkCommand("git", ["--version"], "git is available", true);
  checkCommand(process.env.CODEX_COMMAND || "codex", ["--version"], "Codex CLI is available", false);
  checkCommand("gh", ["--version"], "GitHub CLI is available for PR creation", false);
  checkPackageScripts();
  checkEnvExample();
  checkAuditViewerRuntimeEnv();
  checkCodexPolicyFiles();
  checkDockerExamples();

  printReport();

  if (failures.length > 0) {
    exit(1);
  }
}

function checkNodeVersion() {
  const major = Number.parseInt(nodeVersion.replace(/^v/u, "").split(".")[0] ?? "0", 10);

  if (major >= 20) {
    ok.push(`Node ${major} satisfies the >=20 runtime requirement.`);
    return;
  }

  failures.push("Node >=20 is required.");
}

function checkPackageScripts() {
  const packageJson = readJson("package.json");

  if (!packageJson) {
    return;
  }

  for (const script of requiredScripts) {
    if (!packageJson.scripts?.[script]) {
      failures.push(`package.json is missing script '${script}'.`);
    }
  }

  if (requiredScripts.every((script) => packageJson.scripts?.[script])) {
    ok.push("Required npm scripts are present.");
  }
}

function checkEnvExample() {
  const envExample = readText(".env.example");

  if (!envExample) {
    return;
  }

  const presentKeys = new Set(
    envExample
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0])
      .filter(Boolean)
  );

  for (const key of requiredEnvKeys) {
    if (!presentKeys.has(key)) {
      failures.push(`.env.example is missing ${key}.`);
    }
  }

  const allowlist = readEnvValue(envExample, "CODEX_RUNNER_ENV_ALLOWLIST");

  if (!allowlist) {
    failures.push(".env.example must set CODEX_RUNNER_ENV_ALLOWLIST.");
  } else {
    const allowlistNames = new Set(allowlist.split(/[,\s]+/u).map((entry) => entry.trim()).filter(Boolean));
    const unsafe = forbiddenDefaultEnvNames.filter((name) => allowlistNames.has(name));

    if (unsafe.length > 0) {
      failures.push(`CODEX_RUNNER_ENV_ALLOWLIST includes credential-bearing defaults: ${unsafe.join(", ")}.`);
    }
  }

  if (!existsSync(join(root, ".env"))) {
    warnings.push("No .env file found. Copy .env.example before starting Slack or runner processes.");
  }

  if (requiredEnvKeys.every((key) => presentKeys.has(key))) {
    ok.push(".env.example covers required configuration keys.");
  }
}

function checkAuditViewerRuntimeEnv() {
  const host = process.env.AUDIT_VIEWER_HOST || "127.0.0.1";
  const allowRemote = parseBoolean(process.env.AUDIT_VIEWER_ALLOW_REMOTE);
  const requireAuth = parseBoolean(process.env.AUDIT_VIEWER_REQUIRE_AUTH);
  const hasPassword = Boolean(process.env.AUDIT_VIEWER_PASSWORD?.trim());
  const remoteBind = !isLoopbackHost(host);

  if (remoteBind && !allowRemote) {
    failures.push("AUDIT_VIEWER_HOST is non-loopback; set AUDIT_VIEWER_ALLOW_REMOTE=true only after adding authentication and network controls.");
  }

  if ((remoteBind || allowRemote || requireAuth) && !hasPassword) {
    failures.push("AUDIT_VIEWER_PASSWORD is required when audit viewer remote mode or auth is enabled.");
  }

  if (isPlaceholderSecret(process.env.AUDIT_VIEWER_PASSWORD)) {
    failures.push("AUDIT_VIEWER_PASSWORD must not use a placeholder value.");
  }

  ok.push("Audit viewer runtime posture is safe for setup validation.");
}

function checkCodexPolicyFiles() {
  const profiles = readText("infra/codex/profiles.toml");
  const rules = readText("infra/codex/default.rules");

  if (!profiles || !rules) {
    return;
  }

  for (const profile of ["codex_relay_readonly", "codex_relay_write", "codex_relay_pr", "codex_relay_cleanup"]) {
    if (!profiles.includes(`[profiles.${profile}]`)) {
      failures.push(`infra/codex/profiles.toml is missing ${profile}.`);
    }
  }

  if (/danger-full-access/u.test(profiles)) {
    failures.push("infra/codex/profiles.toml must not contain danger-full-access.");
  }

  if (/network_access\s*=\s*true/u.test(profiles)) {
    failures.push("infra/codex/profiles.toml must not enable network_access by default.");
  }

  if (!/network_access\s*=\s*false/u.test(profiles)) {
    failures.push("infra/codex/profiles.toml must explicitly disable network access.");
  }

  for (const guard of ["rm", "git remote", "curl", "wget", "docker"]) {
    if (!rules.includes(guard)) {
      failures.push(`infra/codex/default.rules is missing a guard mentioning '${guard}'.`);
    }
  }

  if (!/decision\s*=\s*"forbidden"/u.test(rules)) {
    failures.push("infra/codex/default.rules must include forbidden decisions.");
  }

  ok.push("Codex profile and execpolicy files are present.");
}

function checkDockerExamples() {
  if (!existsSync(join(root, "infra/docker/runner.Dockerfile"))) {
    failures.push("infra/docker/runner.Dockerfile is missing.");
    return;
  }

  if (!existsSync(join(root, "infra/docker/docker-compose.example.yml"))) {
    failures.push("infra/docker/docker-compose.example.yml is missing.");
    return;
  }

  ok.push("Docker example files are present.");
}

function checkCommand(command, args, label, required) {
  try {
    execFileSync(command, args, {
      stdio: "ignore",
      timeout: 10_000
    });
    ok.push(label);
  } catch {
    const message = `${label} check failed for command '${basename(command)}'.`;

    if (required) {
      failures.push(message);
    } else {
      warnings.push(message);
    }
  }
}

function readJson(relativePath) {
  const text = readText(relativePath);

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    failures.push(`${relativePath} is not valid JSON.`);
    return undefined;
  }
}

function readText(relativePath) {
  const path = join(root, relativePath);

  if (!existsSync(path)) {
    failures.push(`${relativePath} is missing.`);
    return undefined;
  }

  return readFileSync(path, "utf8");
}

function readEnvValue(text, key) {
  const line = text
    .split(/\r?\n/u)
    .find((entry) => entry.trim().startsWith(`${key}=`));

  return line?.slice(key.length + 1).trim();
}

function parseBoolean(value) {
  return /^(1|true|yes|on)$/iu.test(value?.trim() ?? "");
}

function isLoopbackHost(host) {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/u, "$1");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  );
}

function isPlaceholderSecret(value) {
  if (!value) {
    return false;
  }

  return /^(password|changeme|change-me|change_me|secret|token|example|your-password)$/iu.test(value.trim());
}

function printReport() {
  console.log("Codex Relay setup validation");

  for (const item of ok) {
    console.log(`ok: ${item}`);
  }

  for (const warning of warnings) {
    console.warn(`warn: ${warning}`);
  }

  for (const failure of failures) {
    console.error(`fail: ${failure}`);
  }

  console.log(`summary: ${ok.length} ok, ${warnings.length} warning(s), ${failures.length} failure(s)`);
}
