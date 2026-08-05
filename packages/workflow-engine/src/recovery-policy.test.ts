import { test } from "node:test";
import assert from "node:assert/strict";
import { decideOnFailure } from "./recovery-policy.ts";

test("a non-retryable error blocks immediately regardless of tier or attempts", () => {
  assert.equal(decideOnFailure("standard", 0, false), "block");
});

test("fast tier retries once, then escalates", () => {
  assert.equal(decideOnFailure("fast", 0, true), "retry");
  assert.equal(decideOnFailure("fast", 1, true), "escalate");
});

test("standard tier retries more times before escalating", () => {
  assert.equal(decideOnFailure("standard", 0, true), "retry");
  assert.equal(decideOnFailure("standard", 2, true), "retry");
  assert.equal(decideOnFailure("standard", 3, true), "escalate");
});
