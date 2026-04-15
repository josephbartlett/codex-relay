import assert from "node:assert/strict";
import test from "node:test";
import { classifyFollowUpIntent } from "../apps/orchestrator/src/context.js";

test("repo-qualified no-session mentions start a new task even when the task says stop", () => {
  const intent = classifyFollowUpIntent({
    hasExistingSession: false,
    text: "<@U123> repo:default add RELEASE_SMOKE.md and then stop"
  });

  assert.equal(intent, "new_task");
});

test("existing-session stop follow-ups still cancel", () => {
  const intent = classifyFollowUpIntent({
    hasExistingSession: true,
    text: "<@U123> stop"
  });

  assert.equal(intent, "cancel");
});

test("compound diff then draft PR follow-ups use deterministic PR handoff", () => {
  const intent = classifyFollowUpIntent({
    hasExistingSession: true,
    text: "<@U123> continue by checking the current diff summary, then create a draft PR if there are file changes."
  });

  assert.equal(intent, "update_pr");
});

test("create draft PR follow-ups do not become generic continue plans", () => {
  const intent = classifyFollowUpIntent({
    hasExistingSession: true,
    text: "<@U123> create a draft pull request"
  });

  assert.equal(intent, "update_pr");
});
