import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { recordFactDirectly } from "@ama/knowledge-base";
import { pickGuidance } from "./priority.ts";

function reflection(tenant: string): Actor {
  return { kind: "reflection", tenantId: asTenantId(tenant) };
}
function approver(tenant: string): Actor {
  return { kind: "approver", tenantId: asTenantId(tenant) };
}

// Learning System §5 — "разговорный стиль лучше" (Learning) vs "у клиента
// строгий формальный бренд-гайд" (Knowledge Base): KB must win.
test("a confirmed Knowledge Base fact wins over a Learning Memory conclusion at the same key", () => {
  const store = new MemoryStore();
  const tenantId = asTenantId("tenant-a");

  store.recordLesson(reflection("tenant-a"), { level: "learning", tenantId, key: "tone" }, "casual works better");
  recordFactDirectly(store, approver("tenant-a"), { level: "client_kb", tenantId, key: "tone" }, "strict formal brand guide");

  const guidance = pickGuidance(store, approver("tenant-a"), tenantId, "tone");
  assert.equal(guidance.source, "client_kb");
  assert.equal(guidance.value, "strict formal brand guide");
});

test("falls back to Learning Memory when there is no Knowledge Base fact for that key", () => {
  const store = new MemoryStore();
  const tenantId = asTenantId("tenant-a");

  store.recordLesson(reflection("tenant-a"), { level: "learning", tenantId, key: "tone" }, "casual works better");

  const guidance = pickGuidance(store, approver("tenant-a"), tenantId, "tone");
  assert.equal(guidance.source, "learning");
  assert.equal(guidance.value, "casual works better");
});

test("returns none when neither source has anything for that key", () => {
  const store = new MemoryStore();
  const guidance = pickGuidance(store, approver("tenant-a"), asTenantId("tenant-a"), "unknown");
  assert.equal(guidance.source, "none");
});
