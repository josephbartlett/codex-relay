#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const failures = [];
const ok = [];

const requiredFiles = [
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "AGENTS.md",
  ".env.example",
  ".gitignore",
  ".nvmrc",
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/check.yml",
  "docs/RELEASE_PROCESS.md",
  "docs/RELEASE_READINESS.md",
  "docs/ROADMAP.md",
  "docs/RUNBOOK.md",
  "docs/SECURITY.md",
  "docs/TASKS.md",
  "docs/MAINTENANCE_AUDIT.md",
  "docs/CUSTODY_FIRST_ORCHESTRATION.md",
  "docs/work-packets/README.md",
  "infra/slack/app-manifest.yaml",
  "infra/codex/default.rules",
  "infra/codex/profiles.toml"
];

const ignoredRuntimePrefixes = [
  ".codex-slack/",
  "brand-candidates/",
  "dist/",
  "node_modules/"
];

const ignoredRuntimeFiles = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production"
]);

run();

function run() {
  checkRequiredFiles();
  checkPackageMetadata();
  checkChangelog();
  checkReleaseDocs();
  checkCiWorkflow();
  checkGitignore();
  checkNoTrackedRuntimeState();
  checkMarkdownFences();

  printReport();

  if (failures.length > 0) {
    exit(1);
  }
}

function checkRequiredFiles() {
  const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));

  if (missing.length > 0) {
    failures.push(`Missing release-required files: ${missing.join(", ")}.`);
    return;
  }

  ok.push("Release-required files are present.");
}

function checkPackageMetadata() {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");

  if (!packageJson) {
    return;
  }

  if (packageJson.name !== "codex-relay") {
    failures.push("package.json name must be codex-relay.");
  }

  if (!/^\d+\.\d+\.\d+$/u.test(packageJson.version ?? "")) {
    failures.push("package.json version must use MAJOR.MINOR.PATCH SemVer.");
  }

  if (packageLock?.version && packageLock.version !== packageJson.version) {
    failures.push("package-lock.json version must match package.json version.");
  }

  if (packageLock?.packages?.[""]?.version && packageLock.packages[""].version !== packageJson.version) {
    failures.push("package-lock.json root package version must match package.json version.");
  }

  if (packageJson.private !== true) {
    failures.push("package.json should keep private=true unless npm publication is intentionally designed.");
  }

  const requiredScripts = [
    "validate:setup",
    "validate:live-config",
    "check",
    "check:work-packets",
    "check:release",
    "check:audit",
    "check:secrets"
  ];

  for (const script of requiredScripts) {
    if (!packageJson.scripts?.[script]) {
      failures.push(`package.json is missing script '${script}'.`);
    }
  }

  if (!packageJson.scripts?.check?.includes("check:release")) {
    failures.push("npm run check must include npm run check:release.");
  }

  if (packageJson.license !== "MIT") {
    failures.push("package.json license must be MIT.");
  }

  ok.push("Package metadata and release scripts are consistent.");
}

function checkChangelog() {
  const changelog = readText("CHANGELOG.md");
  const packageJson = readJson("package.json");

  if (!changelog) {
    return;
  }

  requireText(changelog, "CHANGELOG.md", "## [Unreleased]");
  if (packageJson?.version) {
    requirePattern(
      changelog,
      "CHANGELOG.md",
      new RegExp(`^## \\[${escapeRegExp(packageJson.version)}\\] - \\d{4}-\\d{2}-\\d{2}$`, "mu"),
      `## [${packageJson.version}] - YYYY-MM-DD`
    );
  }
  requirePattern(changelog, "CHANGELOG.md", /^## \[0\.1\.0\] - (Pending|\d{4}-\d{2}-\d{2})$/mu, "## [0.1.0] - Pending or a release date");
  requireText(changelog, "CHANGELOG.md", "### Security");
  requireText(changelog, "CHANGELOG.md", "Release readiness");
  ok.push("Changelog has unreleased, current release, and v0.1.0 release sections.");
}

function checkReleaseDocs() {
  const release = readText("docs/RELEASE_PROCESS.md");
  const roadmap = readText("docs/ROADMAP.md");
  const readiness = readText("docs/RELEASE_READINESS.md");
  const runbook = readText("docs/RUNBOOK.md");
  const security = readText("docs/SECURITY.md");

  if (release) {
    requireText(release, "docs/RELEASE_PROCESS.md", "npm run check");
    requireText(release, "docs/RELEASE_PROCESS.md", "npm run check:release");
    requireText(release, "docs/RELEASE_PROCESS.md", "Tag Format");
  }

  if (roadmap) {
    requireText(roadmap, "docs/ROADMAP.md", "Non-Negotiable Acceptance Criteria");
    requireText(roadmap, "docs/ROADMAP.md", "Current Build Order");
  }

  if (readiness) {
    requireText(readiness, "docs/RELEASE_READINESS.md", "Automated Gates");
    requireText(readiness, "docs/RELEASE_READINESS.md", "Manual Gates");
    requireText(readiness, "docs/RELEASE_READINESS.md", "Known Limitations");
    requireText(readiness, "docs/RELEASE_READINESS.md", "Do not tag a release until");
  }

  if (runbook) {
    requireText(runbook, "docs/RUNBOOK.md", "Setup Validator");
    requireText(runbook, "docs/RUNBOOK.md", "SQLite Backup And Restore");
    requireText(runbook, "docs/RUNBOOK.md", "Draft PR Lifecycle");
    requireText(runbook, "docs/RUNBOOK.md", "Worktree Cleanup");
  }

  if (security) {
    requireText(security, "docs/SECURITY.md", "Threat Model");
    requireText(security, "docs/SECURITY.md", "Security Review Checklist");
  }

  ok.push("Release, roadmap, runbook, and security docs cover required sections.");
}

function checkCiWorkflow() {
  const workflow = readText(".github/workflows/check.yml");

  if (!workflow) {
    return;
  }

  requireText(workflow, ".github/workflows/check.yml", "permissions:");
  requireText(workflow, ".github/workflows/check.yml", "contents: read");
  requireText(workflow, ".github/workflows/check.yml", "npm ci");
  requireText(workflow, ".github/workflows/check.yml", "npm run check");
  ok.push("CI workflow installs from lockfile and runs the full check gate.");
}

function checkGitignore() {
  const gitignore = readText(".gitignore");

  if (!gitignore) {
    return;
  }

  const requiredIgnores = [
    "node_modules/",
    "dist/",
    ".env",
    ".env.*",
    "!.env.example",
    ".codex-slack/",
    "brand-candidates/",
    "*.log"
  ];

  for (const entry of requiredIgnores) {
    requireText(gitignore, ".gitignore", entry);
  }

  ok.push("Runtime, secret, generated, and unapproved asset paths are ignored.");
}

function checkNoTrackedRuntimeState() {
  const tracked = gitLsFiles();

  for (const file of tracked) {
    if (ignoredRuntimeFiles.has(file) || ignoredRuntimePrefixes.some((prefix) => file.startsWith(prefix))) {
      failures.push(`Runtime or local-only path is tracked: ${file}.`);
    }
  }

  ok.push("No runtime state, secrets, generated build output, or unapproved brand candidates are tracked.");
}

function checkMarkdownFences() {
  const markdownFiles = gitLsFiles().filter((file) => file.endsWith(".md"));

  for (const file of markdownFiles) {
    const text = readText(file);

    if (!text) {
      continue;
    }

    const fenceCount = [...text.matchAll(/^```/gm)].length;

    if (fenceCount % 2 !== 0) {
      failures.push(`${file} has unbalanced fenced code blocks.`);
    }
  }

  ok.push("Tracked Markdown files have balanced fenced code blocks.");
}

function requireText(text, file, expected) {
  if (!text.includes(expected)) {
    failures.push(`${file} is missing required text: ${expected}`);
  }
}

function requirePattern(text, file, pattern, description) {
  if (!pattern.test(text)) {
    failures.push(`${file} is missing required pattern: ${description}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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

function gitLsFiles() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    failures.push("Unable to list tracked files with git ls-files.");
    return [];
  }
}

function printReport() {
  console.log("Codex Relay release readiness");

  for (const item of ok) {
    console.log(`ok: ${item}`);
  }

  if (failures.length > 0) {
    console.error("summary: release readiness failed");

    for (const failure of failures) {
      console.error(`fail: ${failure}`);
    }

    return;
  }

  console.log("summary: release readiness passed");
}
