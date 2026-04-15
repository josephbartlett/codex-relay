import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

test("live config validator passes strict repo policy without printing values", () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-live-config-"));
  const repo = join(temp, "repo");

  execFileSync("git", ["init", repo], { stdio: "ignore" });

  const envFile = join(temp, ".env");
  writeFileSync(
    envFile,
    [
      "SLACK_BOT_TOKEN=xoxb-valid-token-value",
      "SLACK_APP_TOKEN=xapp-valid-token-value",
      "CODEX_ALLOWED_REPOS=default=" + repo,
      "CODEX_DEFAULT_REPO_ID=default",
      "CODEX_POLICY_MODE=strict",
      "CODEX_ALLOWED_SLACK_USERS=UABC123",
      "CODEX_ALLOWED_SLACK_CHANNELS=CABC123",
      "CODEX_REPO_ALLOWED_SLACK_USERS=default=UABC123",
      "CODEX_REPO_ALLOWED_SLACK_CHANNELS=default=CABC123"
    ].join("\n")
  );

  const output = execFileSync("node", ["scripts/validate-live-config.mjs", "--env-file", envFile], {
    encoding: "utf8"
  });

  assert.match(output, /Codex Relay live config validation/u);
  assert.match(output, /Live config passed/u);
  assert.doesNotMatch(output, /xoxb-valid-token-value/u);
  assert.doesNotMatch(output, /xapp-valid-token-value/u);
});

test("live config validator fails closed for local-dev and missing repo policy", () => {
  const temp = mkdtempSync(join(tmpdir(), "codex-relay-live-config-fail-"));
  const repo = join(temp, "repo");

  execFileSync("git", ["init", repo], { stdio: "ignore" });

  const envFile = join(temp, ".env");
  writeFileSync(
    envFile,
    [
      "SLACK_BOT_TOKEN=xoxb-sensitive-token",
      "SLACK_APP_TOKEN=xapp-sensitive-token",
      "CODEX_ALLOWED_REPOS=default=" + repo,
      "CODEX_DEFAULT_REPO_ID=default",
      "CODEX_POLICY_MODE=local-dev"
    ].join("\n")
  );

  assert.throws(
    () => execFileSync("node", ["scripts/validate-live-config.mjs", "--env-file", envFile], { encoding: "utf8" }),
    (error: unknown) => {
      assert.ok(error && typeof error === "object" && "stdout" in error);
      const output = String((error as { stdout: Buffer | string }).stdout);

      assert.match(output, /CODEX_POLICY_MODE must be strict/u);
      assert.match(output, /Repo 'default' must have repo-specific Slack user and channel policy/u);
      assert.doesNotMatch(output, /xoxb-sensitive-token/u);
      assert.doesNotMatch(output, /xapp-sensitive-token/u);
      return true;
    }
  );
});
