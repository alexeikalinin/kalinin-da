import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { recordFactDirectly } from "@ama/knowledge-base";
import { recordObservation } from "@ama/learning";
import { assemblePrompt } from "./assemble.ts";
import type { RoleTemplate } from "./template-registry.ts";

function approver(): Actor {
  return { kind: "approver", tenantId: asTenantId("tenant-a") };
}
function reflection(): Actor {
  return { kind: "reflection", tenantId: asTenantId("tenant-a") };
}

function context(tier: "fast" | "standard") {
  return createInvocationContext({
    tenantId: asTenantId("tenant-a"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("ppc"),
    executionTier: tier,
    approvalLevel: "strategy-gate",
  });
}

function template(): RoleTemplate {
  return {
    roleId: asRoleId("ppc"),
    version: 1,
    purpose: "Настроить рекламные кампании.",
    responsibility: "Только настройка, не медиапланирование.",
  };
}

test("assembled prompt pulls role text, task text and project context from their documented sources", () => {
  const store = new MemoryStore();
  const you = approver();
  store.write(
    { kind: "agent", tenantId: asTenantId("tenant-a") },
    { level: "project", tenantId: asTenantId("tenant-a"), key: "project-1:research-summary" },
    "Competitors mostly use Google Ads.",
  );

  const prompt = assemblePrompt(store, you, {
    context: context("standard"),
    template: template(),
    taskDescription: "Configure campaigns in Google Ads and VK Ads.",
    clientFactKeys: [],
    domainFactKeys: [],
    projectContextKeys: ["research-summary"],
  });

  assert.match(prompt.role, /Настроить рекламные кампании/);
  assert.equal(prompt.task, "Configure campaigns in Google Ads and VK Ads.");
  assert.deepEqual(prompt.projectContext, ["Competitors mostly use Google Ads."]);
});

test("Fast tier truncates client facts and lessons; Standard keeps more (§2)", () => {
  const store = new MemoryStore();
  const you = approver();
  const tenantId = asTenantId("tenant-a");

  for (const [key, value] of [
    ["fact-1", "Brand colors: blue"],
    ["fact-2", "No holiday promotions"],
    ["fact-3", "Prior VK Ads campaign in 2025"],
    ["fact-4", "Prefers formal tone"],
  ] as const) {
    recordFactDirectly(store, you, { level: "client_kb", tenantId, key }, value);
  }
  for (let i = 0; i < 4; i++) {
    recordObservation(store, reflection(), tenantId, `lesson-${i}`, {
      situation: "VK Ads underperformed for B2B",
      outcome: "problem",
      conclusion: "avoid VK Ads for B2B",
      roleId: asRoleId("ppc"),
      groupKey: "vk-ads-b2b",
    });
  }

  const input = {
    template: template(),
    taskDescription: "task",
    clientFactKeys: ["fact-1", "fact-2", "fact-3", "fact-4"],
    domainFactKeys: [],
    projectContextKeys: [],
  };

  const fast = assemblePrompt(store, you, { ...input, context: context("fast") });
  const standard = assemblePrompt(store, you, { ...input, context: context("standard") });

  assert.equal(fast.clientFacts.length, 3);
  assert.equal(fast.pastExperience.length, 2);
  assert.equal(standard.clientFacts.length, 4);
  assert.equal(standard.pastExperience.length, 4);
});

test("missing keys are silently skipped rather than producing empty/undefined entries", () => {
  const store = new MemoryStore();
  const prompt = assemblePrompt(store, approver(), {
    context: context("standard"),
    template: template(),
    taskDescription: "task",
    clientFactKeys: ["does-not-exist"],
    domainFactKeys: [],
    projectContextKeys: [],
  });
  assert.deepEqual(prompt.clientFacts, []);
});
