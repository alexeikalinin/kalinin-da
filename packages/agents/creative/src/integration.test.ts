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
import { createCopywriterAgent, prepareCopywriterInvocation, type CopywriterModelCaller } from "@ama/agent-copywriter";
import {
  createMediaBuyerAgent,
  prepareMediaBuyerInvocation,
  type MediaBuyerModelCaller,
} from "@ama/agent-media-buyer";
import { createCreativeAgent, type CreativeModelCaller } from "./creative-agent.ts";
import { prepareCreativeInvocation } from "./dispatch.ts";

test("Creative Agent runs after Copywriter and Media Buyer, using the creative-generation tool", async () => {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const tenantId = asTenantId("tenant-a");
  const projectId = asProjectId("project-1");
  const approver = { kind: "approver" as const, tenantId };

  registry.register(approver, { toolId: "creative-generation", displayName: "Creative Generation" });
  credentials.issue(approver, "creative-generation", "token-creative");

  // --- Copywriter runs first, writes to Task Memory ---
  const copyContext = createInvocationContext({
    tenantId,
    projectId,
    taskId: asTaskId("copy-task"),
    roleId: asRoleId("copywriter"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });
  const copyCallModel: CopywriterModelCaller = async () => ({
    draft: { texts: ["Летняя распродажа — скидки до 50%."] },
    decisionSummary: "Текст объявления готов.",
  });
  const { agentInput: copyInput } = prepareCopywriterInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("copywriter"), version: 1, purpose: "Copy", responsibility: "Copy only" },
    context: copyContext,
    taskDescription: "Написать текст объявления.",
    clientFactKeys: [],
    briefs: ["Летняя распродажа"],
    complexity: "routine",
    invokeTool: async () => "unused",
  });
  const copyOutput = await createCopywriterAgent(copyCallModel).invoke(copyInput);
  assert.equal(copyOutput.status, "success");
  store.archiveTaskIntoProject({ kind: "agent", tenantId }, "copy-task", projectId);

  // --- Media Buyer runs, writes directly to Project Memory ---
  const mbContext = createInvocationContext({
    tenantId,
    projectId,
    taskId: asTaskId("media-buyer-task"),
    roleId: asRoleId("media-buyer"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });
  const mbCallModel: MediaBuyerModelCaller = async () => ({
    plan: { totalBudget: 1000, allocation: { "google-ads": 1 } },
    decisionSummary: "Весь бюджет на Google Ads.",
  });
  const { agentInput: mbInput } = prepareMediaBuyerInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("media-buyer"), version: 1, purpose: "MB", responsibility: "MB only" },
    context: mbContext,
    taskDescription: "Спланировать бюджет.",
    clientFactKeys: [],
    complexity: "standard",
    invokeTool: async () => "unused",
  });
  const mbOutput = await createMediaBuyerAgent(mbCallModel).invoke(mbInput);
  assert.equal(mbOutput.status, "success");

  // --- Creative Agent runs, depending on both ---
  const creativeContext = createInvocationContext({
    tenantId,
    projectId,
    taskId: asTaskId("creative-task"),
    roleId: asRoleId("creative"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  let toolArgs: unknown;
  const creativeCallModel: CreativeModelCaller = async (_prompt, _modelId, toolOutput) => ({
    assets: { assetRefs: [`banner-${JSON.stringify(toolOutput)}`], notes: "Соответствует утверждённому тексту." },
    decisionSummary: "Баннер под google-ads сгенерирован по утверждённому тексту.",
  });

  const { agentInput: creativeInput } = prepareCreativeInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("creative"), version: 1, purpose: "Creative", responsibility: "Creative only" },
    context: creativeContext,
    taskDescription: "Создать баннер под google-ads на основе утверждённого текста и бюджета.",
    clientFactKeys: [],
    projectContextKeys: ["copy-task:copy-draft", "media-budget-plan"],
    channels: ["google-ads"],
    complexity: "standard",
    invokeTool: async (toolId, args) => {
      toolArgs = args;
      return { assetRefs: ["asset-1"] };
    },
  });

  const creativeOutput = await createCreativeAgent(creativeCallModel).invoke(creativeInput);
  assert.equal(creativeOutput.status, "success");
  assert.ok(toolArgs, "the creative-generation tool was invoked");
  if (creativeOutput.status === "success") {
    assert.match(creativeOutput.result.notes, /утверждённому тексту/);
  }

  // Task-level output, archived the same way PPC/UI Designer's is.
  store.archiveTaskIntoProject({ kind: "agent", tenantId }, "creative-task", projectId);
  const archived = store.read(
    { kind: "agent", tenantId },
    { level: "project", tenantId, key: `${projectId}:creative-task:creative-assets` },
  );
  assert.ok(archived);
});
