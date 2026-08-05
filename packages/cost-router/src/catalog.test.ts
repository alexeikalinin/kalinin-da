import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnthropicModelCatalog } from "./catalog.ts";

test("each tier resolves to a distinct model id", () => {
  const catalog = createAnthropicModelCatalog();
  const ids = new Set([catalog.resolve("fast"), catalog.resolve("base"), catalog.resolve("advanced")]);
  assert.equal(ids.size, 3);
});

test("cost per call increases with tier (Cost Optimization §4 principle)", () => {
  const catalog = createAnthropicModelCatalog();
  assert.ok(catalog.costPerCall("fast") < catalog.costPerCall("base"));
  assert.ok(catalog.costPerCall("base") < catalog.costPerCall("advanced"));
});
