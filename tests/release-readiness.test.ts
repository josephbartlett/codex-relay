import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("release readiness check passes and reports release gate coverage", () => {
  const output = execFileSync("node", ["scripts/release-readiness.mjs"], {
    encoding: "utf8"
  });

  assert.match(output, /Codex Relay release readiness/u);
  assert.match(output, /release readiness passed/u);
  assert.match(output, /Markdown files have balanced fenced code blocks/u);
});
