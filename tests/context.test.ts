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
