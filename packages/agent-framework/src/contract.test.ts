import { test } from "node:test";
import assert from "node:assert/strict";
import { defineAgent, type AgentInput, type AgentOutput } from "./contract.ts";
import { createInvocationContext } from "./context.ts";
import { asProjectId, asRoleId, asTaskId, asTenantId } from "./ids.ts";

interface Payload {
  readonly siteUrl: string;
}

interface Result {
  readonly campaignsConfigured: number;
}

const noopMemory = {
  read: async () => undefined,
  write: async () => {},
};

const noopTools = {
  invoke: async () => undefined,
};

function samplePpcAgent(
  handler: (input: AgentInput<Payload>) => Promise<AgentOutput<Result>>,
) {
  return defineAgent<Payload, Result>({
    roleId: "ppc",
    displayName: "PPC Agent",
    purpose: "Настроить и запустить рекламные кампании клиента.",
    responsibility: "Только настройка кампаний, не медиапланирование бюджета.",
    completionCriteria: "Результат проходит проверку QA Agent.",
    memoryLevels: ["task", "project", "client_kb"],
    toolIds: ["google-ads", "vk-ads"],
    handler,
  });
}

test("defineAgent exposes the role descriptor without leaking the handler", () => {
  const agent = samplePpcAgent(async () => ({
    status: "success",
    result: { campaignsConfigured: 1 },
    decisions: [],
  }));

  assert.equal(agent.spec.roleId, "ppc");
  assert.equal(agent.spec.memoryLevels.length, 3);
  assert.ok(!("handler" in agent.spec));
});

test("agent invocation runs the handler and returns its status verbatim", async () => {
  const agent = samplePpcAgent(async () => ({
    status: "needs_revision",
    reason: "Бюджет не подтверждён",
  }));

  const context = createInvocationContext({
    tenantId: asTenantId("tenant-1"),
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("ppc"),
    executionTier: "standard",
    approvalLevel: "strategy-gate",
  });

  const output = await agent.invoke({
    task: { context, payload: { siteUrl: "https://example.com" } },
    memory: noopMemory,
    tools: noopTools,
  });

  assert.equal(output.status, "needs_revision");
});
