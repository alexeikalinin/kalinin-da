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
import { recordFactDirectly, YANDEX_DIRECT_REACH_CAMPAIGN_FACT_KEYS, seedYandexDirectReachCampaignFacts } from "@ama/knowledge-base";
import { ToolRegistry, CredentialStore } from "@ama/tools";
import { createAnthropicModelCatalog } from "@ama/cost-router";
import { createPpcAgent, type PpcSetupModelCaller } from "./ppc-agent.ts";
import { preparePpcInvocation } from "./dispatch.ts";

function approver(): Actor {
  return { kind: "approver", tenantId: asTenantId("tenant-a") };
}

// Full pipeline, reproducing the running reference scenario end to end:
// a Client KB fact about a past VK Ads failure (Knowledge Base §4 example)
// actually reaches the "model" through the assembled prompt, and its
// decision drives which tools get called with what arguments.
test("PPC Agent, assembled from memory + tools + prompt architecture + cost router, runs end to end", async () => {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const tenantId = asTenantId("tenant-a");
  const you = approver();

  recordFactDirectly(
    store,
    you,
    { level: "client_kb", tenantId, key: "past-vk-ads" },
    "unsuccessful in 2025",
  );

  registry.register(you, { toolId: "google-ads", displayName: "Google Ads" });
  registry.register(you, { toolId: "vk-ads", displayName: "VK Ads" });
  credentials.issue(you, "google-ads", "token-google");
  credentials.issue(you, "vk-ads", "token-vk");

  const context = createInvocationContext({
    tenantId,
    projectId: asProjectId("project-1"),
    taskId: asTaskId("task-1"),
    roleId: asRoleId("ppc"),
    executionTier: "standard",
    approvalLevel: "strategy-gate",
  });

  const toolCalls: Array<{ toolId: string; args: unknown; credential: unknown }> = [];
  const invokeTool = async (toolId: string, args: unknown, credential: unknown) => {
    toolCalls.push({ toolId, args, credential });
    return { configured: true };
  };

  // Stands in for the real LLM call — reads the assembled prompt's client
  // facts and reacts to them, proving the fact recorded above actually
  // reaches this point through Prompt Architecture's assembly, not just
  // sitting unused in the store.
  const callModel: PpcSetupModelCaller = async (prompt) => {
    const vkHadTrouble = prompt.clientFacts.some((fact) => fact.includes("unsuccessful"));
    const budgetSplit = vkHadTrouble
      ? { "google-ads": 0.8, "vk-ads": 0.2 }
      : { "google-ads": 0.5, "vk-ads": 0.5 };
    return {
      result: { budgetSplit },
      decisionSummary: vkHadTrouble
        ? "Бюджет распределён 80/20 в пользу Google Ads, потому что VK Ads уже показал себя неудачно в 2025."
        : "Бюджет распределён поровну.",
    };
  };

  const { agentInput, modelId } = preparePpcInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: {
      roleId: asRoleId("ppc"),
      version: 1,
      purpose: "Настроить и запустить рекламные кампании клиента.",
      responsibility: "Только настройка кампаний.",
    },
    context,
    taskDescription: "Настроить рекламные кампании в Google Ads и VK Ads.",
    clientFactKeys: ["past-vk-ads"],
    channels: ["google-ads", "vk-ads"],
    complexity: "standard",
    invokeTool,
    siteUrl: "https://example.com",
  });

  // standard complexity -> base tier, nudged down one step by strategy-gate (Cost Optimization §1) -> fast
  assert.equal(modelId, catalog.resolve("fast"));

  const agent = createPpcAgent(callModel);
  const output = await agent.invoke(agentInput);

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.match(output.decisions[0]?.summary ?? "", /80\/20/);
    assert.equal((output.result as { budgetSplit: Record<string, number> }).budgetSplit["google-ads"], 0.8);
  }

  assert.deepEqual(
    toolCalls.map((c) => c.toolId).sort(),
    ["google-ads", "vk-ads"],
  );
  const googleCall = toolCalls.find((c) => c.toolId === "google-ads");
  assert.equal(googleCall?.credential, "token-google");
  assert.equal((googleCall?.args as { budgetShare: number }).budgetShare, 0.8);

  // The decision was written back to Task Memory, per Memory System §1.
  // (createAgentMemoryPort namespaces task-level keys by taskId, so a second
  // concurrent Task never collides on the same "campaign-summary" key.)
  const written = store.read(
    { kind: "agent", tenantId },
    { level: "task", tenantId, key: `${context.taskId}:campaign-summary` },
  );
  assert.deepEqual(written, { budgetSplit: { "google-ads": 0.8, "vk-ads": 0.2 } });
});

// Knowledge Base's "Not yet implemented: initial Domain KB population"
// (Open Question #2), filled in for yandex-direct reach campaigns: proves
// the seeded Domain KB facts actually reach the model through the
// assembled prompt's "Экспертные знания" block, the same way the client_kb
// test above proves it for a client fact — not just sitting unused in the
// store.
test("PPC Agent picks a reach-campaign format using seeded Domain KB facts", async () => {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const tenantId = asTenantId("tenant-a");
  const you = approver();

  seedYandexDirectReachCampaignFacts(store, you, tenantId);

  registry.register(you, { toolId: "yandex-direct", displayName: "Yandex Direct" });
  credentials.issue(you, "yandex-direct", "token-yandex");

  const context = createInvocationContext({
    tenantId,
    projectId: asProjectId("project-2"),
    taskId: asTaskId("task-2"),
    roleId: asRoleId("ppc"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  const toolCalls: Array<{ toolId: string; args: unknown }> = [];
  const invokeTool = async (toolId: string, args: unknown) => {
    toolCalls.push({ toolId, args });
    return { configured: true };
  };

  // Reacts to the domain fact about unskippable video the same way the
  // client_kb test reacts to a client fact — proving it arrived through
  // assembly, not that the model "already knew" it.
  const callModel: PpcSetupModelCaller = async (prompt) => {
    const wantsGuaranteedFullView = prompt.domainKnowledge.some((fact) =>
      fact.includes("гарантированный полный контакт"),
    );
    return {
      result: { budgetSplit: { "yandex-direct": 1 } },
      decisionSummary: wantsGuaranteedFullView
        ? "Выбран формат «Непропускаемое видео» для гарантированного полного контакта с сообщением."
        : "Выбран стандартный формат.",
    };
  };

  const { agentInput } = preparePpcInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: {
      roleId: asRoleId("ppc"),
      version: 1,
      purpose: "Настроить и запустить рекламные кампании клиента.",
      responsibility: "Только настройка кампаний.",
    },
    context,
    taskDescription: "Запустить охватную кампанию в Яндекс.Директе с гарантированным досмотром.",
    clientFactKeys: [],
    domainFactKeys: YANDEX_DIRECT_REACH_CAMPAIGN_FACT_KEYS,
    channels: ["yandex-direct"],
    complexity: "standard",
    invokeTool,
    siteUrl: "https://example.com",
  });

  const output = await createPpcAgent(callModel).invoke(agentInput);

  assert.equal(output.status, "success");
  if (output.status === "success") {
    assert.match(output.decisions[0]?.summary ?? "", /Непропускаемое видео/);
  }
  assert.equal(toolCalls[0]?.toolId, "yandex-direct");
});
