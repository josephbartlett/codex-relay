import assert from "node:assert/strict";
import test from "node:test";
import { authorizeSlackAction } from "../packages/shared/src/authorization.js";
import { loadConfig } from "../packages/shared/src/config.js";

test("strict policy requires explicit repo policy, user, and channel authorization", () => {
  const config = testConfig({
    CODEX_POLICY_MODE: "strict",
    CODEX_ALLOWED_SLACK_USERS: "U1 U2",
    CODEX_ALLOWED_SLACK_CHANNELS: "C1 C2",
    CODEX_REPO_ALLOWED_SLACK_USERS: "default=U1",
    CODEX_REPO_ALLOWED_SLACK_CHANNELS: "default=C1"
  });

  assert.deepEqual(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U1",
      slackChannelId: "C1",
      repoId: "default"
    }),
    { ok: true }
  );
  assert.equal(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U2",
      slackChannelId: "C1",
      repoId: "default"
    }).reason,
    "repo_user_not_allowed"
  );
  assert.equal(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U1",
      slackChannelId: "C2",
      repoId: "default"
    }).reason,
    "repo_channel_not_allowed"
  );
});

test("strict repo policy narrows global user and channel allowlists", () => {
  const config = testConfig({
    CODEX_POLICY_MODE: "strict",
    CODEX_ALLOWED_SLACK_USERS: "U-global U-repo",
    CODEX_ALLOWED_SLACK_CHANNELS: "C-global C-repo",
    CODEX_REPO_ALLOWED_SLACK_USERS: "default=U-repo",
    CODEX_REPO_ALLOWED_SLACK_CHANNELS: "default=C-repo"
  });

  assert.equal(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U-global",
      slackChannelId: "C-repo",
      repoId: "default"
    }).reason,
    "repo_user_not_allowed"
  );
  assert.equal(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U-repo",
      slackChannelId: "C-global",
      repoId: "default"
    }).reason,
    "repo_channel_not_allowed"
  );
  assert.deepEqual(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U-repo",
      slackChannelId: "C-repo",
      repoId: "default"
    }),
    { ok: true }
  );
});

test("strict policy fails closed for missing channel or missing repo policy", () => {
  const config = testConfig({
    CODEX_POLICY_MODE: "strict",
    CODEX_ALLOWED_SLACK_USERS: "U1",
    CODEX_ALLOWED_SLACK_CHANNELS: "C1",
    CODEX_REPO_ALLOWED_SLACK_USERS: "default=U1",
    CODEX_REPO_ALLOWED_SLACK_CHANNELS: "default=C1"
  });

  assert.equal(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U1",
      repoId: "default"
    }).reason,
    "channel_required"
  );
  assert.equal(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U1",
      slackChannelId: "C1",
      repoId: "other"
    }).reason,
    "repo_policy_required"
  );
});

test("strict modal prechecks pass when a user and channel are allowed by any repo policy", () => {
  const config = testConfig({
    CODEX_POLICY_MODE: "strict",
    CODEX_REPO_ALLOWED_SLACK_USERS: "default=U1",
    CODEX_REPO_ALLOWED_SLACK_CHANNELS: "default=C1"
  });

  assert.deepEqual(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U1",
      slackChannelId: "C1"
    }),
    { ok: true }
  );
  assert.equal(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U2",
      slackChannelId: "C1"
    }).reason,
    "user_not_allowed"
  );
});

test("local-dev policy permits empty allowlists for isolated development", () => {
  const config = testConfig({
    CODEX_POLICY_MODE: "local-dev"
  });

  assert.deepEqual(
    authorizeSlackAction(config, {
      action: "start_task",
      slackUserId: "U-any",
      slackChannelId: "C-any",
      repoId: "default"
    }),
    { ok: true }
  );
});

test("maintainers bypass user allowlists but not channel policy", () => {
  const config = testConfig({
    CODEX_POLICY_MODE: "strict",
    CODEX_ALLOWED_SLACK_USERS: "U1",
    CODEX_MAINTAINER_SLACK_USERS: "UM",
    CODEX_ALLOWED_SLACK_CHANNELS: "C1 C2",
    CODEX_REPO_ALLOWED_SLACK_USERS: "default=U1",
    CODEX_REPO_ALLOWED_SLACK_CHANNELS: "default=C1"
  });

  assert.deepEqual(
    authorizeSlackAction(config, {
      action: "approve_execution",
      slackUserId: "UM",
      slackChannelId: "C1",
      repoId: "default"
    }),
    { ok: true }
  );
  assert.equal(
    authorizeSlackAction(config, {
      action: "approve_execution",
      slackUserId: "UM",
      slackChannelId: "C2",
      repoId: "default"
    }).reason,
    "repo_channel_not_allowed"
  );
});

test("config rejects repo policy entries for unknown repos", () => {
  assert.throws(
    () =>
      testConfig({
        CODEX_POLICY_MODE: "strict",
        CODEX_REPO_ALLOWED_SLACK_USERS: "missing=U1"
      }),
    /unknown repo id/
  );
});

function testConfig(overrides: Record<string, string>) {
  return loadConfig({
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_APP_TOKEN: "xapp-test",
    CODEX_ALLOWED_REPOS: "default=/tmp/codex-relay-test,other=/tmp/codex-relay-other",
    CODEX_DEFAULT_REPO_ID: "default",
    ...overrides
  });
}
