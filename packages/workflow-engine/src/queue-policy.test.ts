import { test } from "node:test";
import assert from "node:assert/strict";
import { isStuck } from "./queue-policy.ts";

test("fast tier task is stuck after its short threshold", () => {
  const dispatchedAt = 0;
  assert.equal(isStuck(dispatchedAt, "fast", 60_000), false);
  assert.equal(isStuck(dispatchedAt, "fast", 3 * 60_000), true);
});

test("standard tier tolerates a longer running time before being stuck", () => {
  const dispatchedAt = 0;
  assert.equal(isStuck(dispatchedAt, "standard", 5 * 60_000), false);
  assert.equal(isStuck(dispatchedAt, "standard", 20 * 60_000), true);
});
