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
import { createUxAgent, prepareUxInvocation, type UxModelCaller } from "@ama/agent-ux";
import { createUiDesignerAgent, type UiDesignerModelCaller } from "./ui-designer-agent.ts";
import { prepareUiDesignerInvocation } from "./dispatch.ts";

test("UI Designer runs after UX and reads its plan from Project Memory", async () => {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const tenantId = asTenantId("tenant-a");
  const projectId = asProjectId("project-1");
  const approver = { kind: "approver" as const, tenantId };

  registry.register(approver, { toolId: "design-tool", displayName: "Design Tool" });
  credentials.issue(approver, "design-tool", "token-design");

  // --- UX runs first, writes directly to Project Memory ---
  const uxContext = createInvocationContext({
    tenantId,
    projectId,
    taskId: asTaskId("ux-task"),
    roleId: asRoleId("ux"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });
  const uxCallModel: UxModelCaller = async () => ({
    plan: { userFlows: ["browse -> product -> checkout"], structureNotes: "3-step funnel." },
    decisionSummary: "3-шаговая воронка.",
  });
  const { agentInput: uxInput } = prepareUxInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("ux"), version: 1, purpose: "UX", responsibility: "UX only" },
    context: uxContext,
    taskDescription: "Design the user flow.",
    clientFactKeys: [],
    complexity: "standard",
    invokeTool: async () => "unused",
  });
  const uxOutput = await createUxAgent(uxCallModel).invoke(uxInput);
  assert.equal(uxOutput.status, "success");

  // UX wrote directly to Project Memory — no archiving step needed (unlike
  // Task-memory-writing roles such as Research/PPC).
  const uxPlan = store.read(
    { kind: "agent", tenantId },
    { level: "project", tenantId, key: `${projectId}:ux-plan` },
  );
  assert.ok(uxPlan);

  // --- UI Designer runs, uses the design tool, and (in a real pipeline)
  // would have UX's plan available via Project Memory for its own reads ---
  const uiContext = createInvocationContext({
    tenantId,
    projectId,
    taskId: asTaskId("ui-task"),
    roleId: asRoleId("ui-designer"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  const uiCallModel: UiDesignerModelCaller = async () => ({
    design: { mockupRefs: ["mockup-1"], designNotes: "Follows the 3-step funnel from UX." },
    decisionSummary: "Макет следует 3-шаговой воронке.",
  });

  const { agentInput: uiInput } = prepareUiDesignerInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: {
      roleId: asRoleId("ui-designer"),
      version: 1,
      purpose: "UI Designer",
      responsibility: "UI Designer only",
    },
    context: uiContext,
    taskDescription: "Design mockups based on the UX plan.",
    clientFactKeys: [],
    projectContextKeys: ["ux-plan"],
    complexity: "standard",
    invokeTool: async () => ({ canvasId: "abc123" }),
  });

  const uiOutput = await createUiDesignerAgent(uiCallModel).invoke(uiInput);
  assert.equal(uiOutput.status, "success");
  if (uiOutput.status === "success") {
    assert.match(uiOutput.result.designNotes, /3-step funnel/);
  }
});
