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
import { createQaAgent, type QaModelCaller } from "./qa-agent.ts";
import { prepareQaInvocation } from "./dispatch.ts";

test("QA reviews PPC's actual decision through the full dispatch pipeline", async () => {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const tenantId = asTenantId("tenant-a");

  const context = createInvocationContext({
    tenantId,
    projectId: asProjectId("project-1"),
    taskId: asTaskId("qa-task"),
    roleId: asRoleId("qa"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  const ppcResult = { budgetSplit: { "google-ads": 1, "vk-ads": 0 } }; // no rationale for 100/0 split

  let toolCalled = false;
  const invokeTool = async () => {
    toolCalled = true;
    return "should never be called — QA declares no tools";
  };

  const callModel: QaModelCaller = async (_prompt, _modelId, artifact) => {
    const split = (artifact as { budgetSplit: Record<string, number> }).budgetSplit;
    const allInOneChannel = Object.values(split).some((share) => share === 1);
    return allInOneChannel
      ? { verdict: { approved: false, issues: ["100% в один канал без обоснования"] }, decisionSummary: "Не хватает обоснования." }
      : { verdict: { approved: true, issues: [] }, decisionSummary: "Ок." };
  };

  const { agentInput } = prepareQaInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("qa"), version: 1, purpose: "QA", responsibility: "QA only" },
    context,
    taskDescription: "Проверить результат PPC Agent.",
    artifactToReview: ppcResult,
    checklistId: "ppc-checklist",
    complexity: "routine",
    invokeTool,
  });

  const output = await createQaAgent(callModel).invoke(agentInput);

  assert.equal(output.status, "success");
  assert.equal(toolCalled, false);
  if (output.status === "success") {
    assert.equal(output.result.approved, false);
    assert.equal(output.result.issues.length, 1);
  }

  const stored = store.read(
    { kind: "agent", tenantId },
    { level: "project", tenantId, key: `${context.projectId}:qa-verdict` },
  );
  assert.deepEqual(stored, { approved: false, issues: ["100% в один канал без обоснования"] });
});
