import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRunnerEnvironment } from "../apps/orchestrator/src/runner/ExecAdapter.js";
import { evaluateRunnerPolicyFiles } from "../apps/local-runner/src/startupChecks.js";
import { loadConfig } from "../packages/shared/src/config.js";

const profilesContent = readFileSync("infra/codex/profiles.toml", "utf8");
const rulesContent = readFileSync("infra/codex/default.rules", "utf8");

test("runner config parses env allowlist and policy paths", () => {
  const config = loadConfig({
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_APP_TOKEN: "xapp-test",
    CODEX_ALLOWED_REPOS: "default=/tmp/codex-relay-test",
    CODEX_RUNNER_ENV_ALLOWLIST: "PATH,HOME,CODEX_HOME",
    CODEX_PROFILES_PATH: "infra/codex/profiles.toml",
    CODEX_RULES_PATH: "infra/codex/default.rules",
    CODEX_REQUIRE_EXECPOLICY_CHECK: "false"
  });

  assert.deepEqual(config.codex.runnerEnvAllowlist, ["PATH", "HOME", "CODEX_HOME"]);
  assert.equal(toPosixPath(config.codex.profilesPath).endsWith("infra/codex/profiles.toml"), true);
  assert.equal(toPosixPath(config.codex.rulesPath).endsWith("infra/codex/default.rules"), true);
  assert.equal(config.codex.requireExecPolicyCheck, false);
});

test("runner environment filter keeps allowlisted values and drops secrets", () => {
  const env = buildRunnerEnvironment(
    {
      PATH: "/usr/bin",
      HOME: "/home/test",
      SLACK_BOT_TOKEN: "xoxb-secret",
      OPENAI_API_KEY: "sk-secret",
      GITHUB_TOKEN: "ghp-secret",
      NO_COLOR: "0"
    },
    ["PATH", "HOME"]
  );

  assert.deepEqual(env, {
    PATH: "/usr/bin",
    HOME: "/home/test",
    NO_COLOR: "1"
  });
});

test("shipped runner profiles and execpolicy rules pass posture checks", () => {
  const result = evaluateRunnerPolicyFiles({ profilesContent, rulesContent });

  assert.deepEqual(result.failures, []);
});

test("runner policy check rejects dangerous profiles and incomplete rules", () => {
  const result = evaluateRunnerPolicyFiles({
    profilesContent: `
[profiles.codex_relay_readonly]
sandbox_mode = "danger-full-access"

[sandbox_workspace_write]
network_access = true
`,
    rulesContent: `
prefix_rule(
  pattern = ["rm", "-rf"],
  decision = "allow",
)
`
  });

  assert.equal(result.failures.some((failure) => failure.includes("codex_relay_write")), true);
  assert.equal(result.failures.some((failure) => failure.includes("danger-full-access")), true);
  assert.equal(result.failures.some((failure) => failure.includes("network_access")), true);
  assert.equal(result.failures.some((failure) => failure.includes("forbidden")), true);
});

test("runner policy check does not accept commented execpolicy text as a guard", () => {
  const result = evaluateRunnerPolicyFiles({
    profilesContent,
    rulesContent: `
# prefix_rule(
#   pattern = [["curl", "wget", "nc", "netcat"]],
#   decision = "forbidden",
# )
`
  });

  assert.equal(result.failures.some((failure) => failure.includes("network tools")), true);
  assert.equal(result.failures.some((failure) => failure.includes("prefix_rule")), true);
});

function toPosixPath(path: string): string {
  return path.replace(/\\/gu, "/");
}
