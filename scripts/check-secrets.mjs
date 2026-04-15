#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const ignoredDirectories = new Set([
  ".git",
  ".codex-slack",
  "brand-candidates",
  "dist",
  "node_modules"
]);
const ignoredFiles = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production"
]);
const allowedPlaceholderPatterns = [
  /xoxb-your-bot-token/,
  /xapp-your-socket-mode-app-token/,
  /ghp_example/i,
  /sk-example/i
];
const checks = [
  { name: "Slack bot token", pattern: /xoxb-[A-Za-z0-9-]{20,}/g },
  { name: "Slack app token", pattern: /xapp-[A-Za-z0-9-]{20,}/g },
  { name: "OpenAI API key", pattern: /sk-[A-Za-z0-9_-]{32,}/g },
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9_]{30,}/g },
  { name: "Private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  {
    name: "Committed env assignment",
    pattern: /^(?:SLACK_(?:BOT_TOKEN|APP_TOKEN|SIGNING_SECRET)|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|EMAIL_SMTP_PASSWORD)=\S+/gm
  }
];
const findings = [];

for (const file of walk(root)) {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file).replaceAll("\\", "/");

  for (const check of checks) {
    for (const match of text.matchAll(check.pattern)) {
      const value = match[0];

      if (allowedPlaceholderPatterns.some((pattern) => pattern.test(value))) {
        continue;
      }

      findings.push({
        file: rel,
        check: check.name,
        line: lineForIndex(text, match.index ?? 0)
      });
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found:");

  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.check}`);
  }

  exit(1);
}

console.log("No obvious secrets found.");

function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const rel = relative(root, fullPath).replaceAll("\\", "/");

    if (ignoredDirectories.has(entry) || ignoredFiles.has(rel) || ignoredFiles.has(entry)) {
      continue;
    }

    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      yield* walk(fullPath);
      continue;
    }

    if (!stat.isFile() || stat.size > 1024 * 1024) {
      continue;
    }

    yield fullPath;
  }
}

function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}
