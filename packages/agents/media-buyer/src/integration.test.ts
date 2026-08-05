import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
} from "@ama/agent-framework";
import { MemoryStore } from "@ama/memory";
import { ToolRegistry, CredentialStore } from "@ama/tools";
import { createAnthropicModelCatalog } from "@ama/cost-router";
import { createMediaBuyerAgent, type MediaBuyerModelCaller } from "./media-buyer-agent.ts";
import { prepareMediaBuyerInvocation } from "./dispatch.ts";

test("Media Buyer Agent runs end to end without ever touching a tool", async () => {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const tenantId = asTenantId("tenant-a");

  const context = createInvocationContext({
    tenantId,
    projectId: asProjectId("project-1"),
    taskId: asTaskId("mb-task-1"),
    roleId: asRoleId("media-buyer"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  let toolCalled = false;
  const invokeTool = async () => {
    toolCalled = true;
    return "should never happen";
  };

  const callModel: MediaBuyerModelCaller = async () => ({
    plan: { totalBudget: 5000, allocation: { "google-ads": 0.7, "vk-ads": 0.3 } },
    decisionSummary: "70% Google Ads, 30% VK Ads по историческому CTR.",
  });

  const { agentInput } = prepareMediaBuyerInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: {
      roleId: asRoleId("media-buyer"),
      version: 1,
      purpose: "Спланировать медиа-бюджет.",
      responsibility: "Только стратегия бюджета.",
    },
    context,
    taskDescription: "Спланировать бюджет на рекламные каналы.",
    clientFactKeys: [],
    complexity: "standard",
    invokeTool,
  });

  const agent = createMediaBuyerAgent(callModel);
  const output = await agent.invoke(agentInput);

  assert.equal(output.status, "success");
  assert.equal(toolCalled, false);

  // createAgentMemoryPort namespaces project-level keys by projectId, so a
  // second concurrent Project for the same tenant never collides here.
  const plan = store.read(
    { kind: "agent", tenantId },
    { level: "project", tenantId, key: `${context.projectId}:media-budget-plan` },
  );
  assert.deepEqual(plan, { totalBudget: 5000, allocation: { "google-ads": 0.7, "vk-ads": 0.3 } });
});
