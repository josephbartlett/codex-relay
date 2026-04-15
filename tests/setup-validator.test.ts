import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("setup validator runs without live Slack credentials and does not print secrets", () => {
  const output = execFileSync("node", ["scripts/validate-setup.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      SLACK_BOT_TOKEN: "xoxb-test-secret",
      SLACK_APP_TOKEN: "xapp-test-secret",
      OPENAI_API_KEY: "sk-test-secret",
      GITHUB_TOKEN: "ghp_test_secret"
    }
  });

  assert.match(output, /Codex Relay setup validation/u);
  assert.doesNotMatch(output, /xoxb-test-secret/u);
  assert.doesNotMatch(output, /xapp-test-secret/u);
  assert.doesNotMatch(output, /sk-test-secret/u);
  assert.doesNotMatch(output, /ghp_test_secret/u);
  assert.match(output, /summary:/u);
});
