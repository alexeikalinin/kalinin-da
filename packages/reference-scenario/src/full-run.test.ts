import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  asTenantId,
  createInvocationContext,
  type AgentOutput,
} from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { ToolRegistry, CredentialStore, ToolUnavailableError } from "@ama/tools";
import { createAnthropicModelCatalog } from "@ama/cost-router";
import {
  attachLogSink,
  createEventBus,
  planApproved,
  planReady,
  projectCompleted,
  projectCreated,
  reconstructJournal,
  taskQueued,
  taskStarted,
  taskSucceeded,
} from "@ama/events";
import {
  approvePlan,
  buildGraph,
  decideOnFailure,
  getReadyNodes,
  initialGraphState,
  isGraphComplete,
  statusAfterPlanBuilt,
  withNodeState,
  type WorkflowNode,
} from "@ama/workflow-engine";
import { createResearchAgent, prepareResearchInvocation } from "@ama/agent-research";
import { createPpcAgent, preparePpcInvocation } from "@ama/agent-ppc";
import { createMediaBuyerAgent, prepareMediaBuyerInvocation } from "@ama/agent-media-buyer";
import { createAnalyticsAgent, prepareAnalyticsInvocation } from "@ama/agent-analytics";
import { createQaAgent, prepareQaInvocation } from "@ama/agent-qa";
import { createReportGeneratorAgent, prepareReportGeneratorInvocation } from "@ama/agent-report-generator";
import { reflect } from "@ama/agent-reflection";

// Business Goals, "Год 1": the reference scenario working end to end for
// Owner — the whole conveyor, real graph/state/events, Strategy-gate,
// and one Recovery moment — not just agents chained two at a time.
test("the full reference scenario runs end to end through the real Workflow Engine graph", async () => {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const bus = createEventBus();
  const log = attachLogSink(bus);

  const tenantId = asTenantId("tenant-a");
  const projectId = asProjectId("project-1");
  const you: Actor = { kind: "approver", tenantId };
  const agentActor: Actor = { kind: "agent", tenantId };

  for (const toolId of ["site-reader", "web-search", "google-ads", "vk-ads", "google-analytics"]) {
    registry.register(you, { toolId, displayName: toolId });
    credentials.issue(you, toolId, `token-${toolId}`);
  }

  // Workflow Engine §1's own reference graph.
  const nodes: readonly WorkflowNode[] = [
    { taskId: "research-task", roleId: asRoleId("research"), dependsOn: [] },
    { taskId: "ppc-task", roleId: asRoleId("ppc"), dependsOn: ["research-task"] },
    { taskId: "media-buyer-task", roleId: asRoleId("media-buyer"), dependsOn: ["research-task"] },
    {
      taskId: "analytics-task",
      roleId: asRoleId("analytics"),
      dependsOn: ["ppc-task", "media-buyer-task"],
    },
    { taskId: "qa-task", roleId: asRoleId("qa"), dependsOn: ["analytics-task"] },
    { taskId: "report-task", roleId: asRoleId("report-generator"), dependsOn: ["qa-task"] },
  ];
  const graph = buildGraph(nodes);
  let state = initialGraphState(graph);

  await bus.publish(projectCreated({ tenantId, projectId }));
  await bus.publish(planReady({ tenantId, projectId }));

  // --- Strategy-gate: the plan pauses for approval before anything runs (default per FR-2 Decision Log) ---
  let planStatus = statusAfterPlanBuilt("strategy-gate");
  assert.equal(planStatus, "awaiting_approval");
  planStatus = approvePlan(planStatus);
  assert.equal(planStatus, "executing");
  await bus.publish(planApproved({ tenantId, projectId }));

  function ctx(taskId: string, roleId: string, tier: "fast" | "standard" = "standard") {
    return createInvocationContext({
      tenantId,
      projectId,
      taskId: asTaskId(taskId),
      roleId: asRoleId(roleId),
      executionTier: tier,
      approvalLevel: "strategy-gate",
    });
  }

  async function completeNode<T>(taskId: string, roleId: string, invoke: () => Promise<AgentOutput<T>>) {
    state = withNodeState(state, taskId, "running");
    await bus.publish(taskStarted({ tenantId, projectId, taskId: asTaskId(taskId), roleId: asRoleId(roleId) }));
    const output = await invoke();
    if (output.status === "success") {
      state = withNodeState(state, taskId, "succeeded");
      store.archiveTaskIntoProject(agentActor, taskId, projectId);
    }
    return output;
  }

  // --- Research (root) ---
  let ready = getReadyNodes(graph, state);
  assert.deepEqual(ready.map((n) => n.taskId), ["research-task"]);
  for (const node of ready) {
    state = withNodeState(state, node.taskId, "queued");
    await bus.publish(
      taskQueued({ tenantId, projectId, taskId: asTaskId(node.taskId), roleId: node.roleId }),
    );
  }

  const { agentInput: researchInput } = prepareResearchInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("research"), version: 1, purpose: "Research", responsibility: "Research only" },
    context: ctx("research-task", "research"),
    taskDescription: "Analyze the client's site and market.",
    siteUrl: "https://client.example",
    searchQuery: "client competitors",
    complexity: "standard",
    invokeTool: async () => "some tool output",
  });
  const researchOutput = await completeNode("research-task", "research", () =>
    createResearchAgent(async () => ({
      findings: { summary: "Running shoe retailer.", facts: ["Competitors favor Google Ads."] },
      decisionSummary: "Собраны исходные данные.",
    })).invoke(researchInput),
  );
  assert.equal(researchOutput.status, "success");
  await bus.publish(
    taskSucceeded(
      { tenantId, projectId, taskId: asTaskId("research-task"), roleId: asRoleId("research") },
      [{ summary: "Собраны исходные данные." }],
    ),
  );

  // --- PPC and Media Buyer become ready together (NFR-5 parallelism) ---
  ready = getReadyNodes(graph, state);
  assert.deepEqual(ready.map((n) => n.taskId).sort(), ["media-buyer-task", "ppc-task"]);
  for (const node of ready) {
    state = withNodeState(state, node.taskId, "queued");
    await bus.publish(
      taskQueued({ tenantId, projectId, taskId: asTaskId(node.taskId), roleId: node.roleId }),
    );
  }

  const { agentInput: ppcInput } = preparePpcInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("ppc"), version: 1, purpose: "PPC", responsibility: "PPC only" },
    context: ctx("ppc-task", "ppc"),
    taskDescription: "Configure campaigns.",
    clientFactKeys: [],
    channels: ["google-ads", "vk-ads"],
    complexity: "standard",
    invokeTool: async () => "configured",
    siteUrl: "https://example.com",
  });
  const { agentInput: mediaBuyerInput } = prepareMediaBuyerInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("media-buyer"), version: 1, purpose: "MB", responsibility: "MB only" },
    context: ctx("media-buyer-task", "media-buyer"),
    taskDescription: "Plan overall media budget.",
    clientFactKeys: [],
    complexity: "standard",
    invokeTool: async () => "unused",
  });

  const [ppcOutput, mediaBuyerOutput] = await Promise.all([
    completeNode("ppc-task", "ppc", () =>
      createPpcAgent(async () => ({
        result: { budgetSplit: { "google-ads": 0.6, "vk-ads": 0.4 } },
        decisionSummary: "60/40 Google/VK.",
      })).invoke(ppcInput),
    ),
    completeNode("media-buyer-task", "media-buyer", () =>
      createMediaBuyerAgent(async () => ({
        plan: { totalBudget: 5000, allocation: { "google-ads": 0.7, "vk-ads": 0.3 } },
        decisionSummary: "Общий бюджет 5000.",
      })).invoke(mediaBuyerInput),
    ),
  ]);
  assert.equal(ppcOutput.status, "success");
  assert.equal(mediaBuyerOutput.status, "success");
  await bus.publish(
    taskSucceeded({ tenantId, projectId, taskId: asTaskId("ppc-task"), roleId: asRoleId("ppc") }, [
      { summary: "60/40 Google/VK." },
    ]),
  );
  await bus.publish(
    taskSucceeded(
      { tenantId, projectId, taskId: asTaskId("media-buyer-task"), roleId: asRoleId("media-buyer") },
      [{ summary: "Общий бюджет 5000." }],
    ),
  );

  // Analytics is not ready until BOTH PPC and Media Buyer succeed.
  ready = getReadyNodes(graph, state);
  assert.deepEqual(ready.map((n) => n.taskId), ["analytics-task"]);

  // --- Analytics: exercise Recovery — the tool fails once (transient), retries, then succeeds ---
  let analyticsAttempts = 0;
  const { agentInput: analyticsInput } = prepareAnalyticsInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("analytics"), version: 1, purpose: "Analytics", responsibility: "Analytics only" },
    context: ctx("analytics-task", "analytics"),
    taskDescription: "Evaluate campaign performance.",
    clientFactKeys: [],
    projectContextKeys: [],
    complexity: "standard",
    invokeTool: async () => {
      analyticsAttempts += 1;
      if (analyticsAttempts === 1) throw new ToolUnavailableError("analytics API timeout");
      return { ctr: 0.05 };
    },
    projectDisplayName: "Test Project",
    siteUrl: "https://example.com",
    analyticsToolIds: ["google-analytics"],
  });
  state = withNodeState(state, "analytics-task", "queued");
  await bus.publish(
    taskQueued({ tenantId, projectId, taskId: asTaskId("analytics-task"), roleId: asRoleId("analytics") }),
  );
  const analyticsOutput = await completeNode("analytics-task", "analytics", () =>
    createAnalyticsAgent(async () => ({
      report: { summary: "On target.", metrics: { ctr: 0.05 } },
      decisionSummary: "CTR в норме.",
    })).invoke(analyticsInput),
  );
  assert.equal(analyticsOutput.status, "success");
  // Recovery §3: retry happened inside the tool call itself (Tool Integration §4)
  // — Recovery's retry/escalate/block policy agrees this should have been a retry, not an escalation.
  assert.equal(analyticsAttempts, 2);
  assert.equal(decideOnFailure("standard", 0, true), "retry");
  await bus.publish(
    taskSucceeded(
      { tenantId, projectId, taskId: asTaskId("analytics-task"), roleId: asRoleId("analytics") },
      [{ summary: "CTR в норме." }],
    ),
  );

  // --- QA reviews the Analytics report ---
  ready = getReadyNodes(graph, state);
  assert.deepEqual(ready.map((n) => n.taskId), ["qa-task"]);
  // Analytics wrote directly to Project Memory (no archiving needed —
  // unlike Research/PPC's Task Memory, this was never task-scoped).
  const analyticsReport = store.read(agentActor, {
    level: "project",
    tenantId,
    key: `${projectId}:analytics-report`,
  });
  const { agentInput: qaInput } = prepareQaInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("qa"), version: 1, purpose: "QA", responsibility: "QA only" },
    context: ctx("qa-task", "qa"),
    taskDescription: "Review the analytics report.",
    artifactToReview: analyticsReport,
    checklistId: "analytics-checklist",
    complexity: "routine",
    invokeTool: async () => "unused",
  });
  state = withNodeState(state, "qa-task", "queued");
  await bus.publish(taskQueued({ tenantId, projectId, taskId: asTaskId("qa-task"), roleId: asRoleId("qa") }));
  const qaOutput = await completeNode("qa-task", "qa", () =>
    createQaAgent(async () => ({
      verdict: { approved: true, issues: [] },
      decisionSummary: "Отчёт одобрен.",
    })).invoke(qaInput),
  );
  assert.equal(qaOutput.status, "success");
  if (qaOutput.status === "success") assert.equal(qaOutput.result.approved, true);
  await bus.publish(
    taskSucceeded({ tenantId, projectId, taskId: asTaskId("qa-task"), roleId: asRoleId("qa") }, [
      { summary: "Отчёт одобрен." },
    ]),
  );

  // --- Report Generator assembles the final Project Output ---
  ready = getReadyNodes(graph, state);
  assert.deepEqual(ready.map((n) => n.taskId), ["report-task"]);
  const { agentInput: reportInput } = prepareReportGeneratorInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("report-generator"), version: 1, purpose: "Report", responsibility: "Report only" },
    context: ctx("report-task", "report-generator"),
    taskDescription: "Assemble the final Project Output.",
    // Research/PPC wrote Task Memory, later archived into Project Memory
    // (taskId-prefixed keys). Media Buyer/Analytics/QA wrote directly to
    // Project Memory (plain keys) — see their own agents for why.
    materialRefs: [
      { roleId: asRoleId("research"), key: "research-task:findings" },
      { roleId: asRoleId("ppc"), key: "ppc-task:campaign-summary" },
      { roleId: asRoleId("media-buyer"), key: "media-budget-plan" },
      { roleId: asRoleId("analytics"), key: "analytics-report" },
      { roleId: asRoleId("qa"), key: "qa-verdict" },
    ],
    complexity: "routine",
    invokeTool: async () => "unused",
  });
  state = withNodeState(state, "report-task", "queued");
  await bus.publish(
    taskQueued({ tenantId, projectId, taskId: asTaskId("report-task"), roleId: asRoleId("report-generator") }),
  );
  const reportOutput = await completeNode("report-task", "report-generator", () =>
    createReportGeneratorAgent(async (_prompt, _modelId, materials) => ({
      narrativeSummary: `Assembled ${Object.keys(materials).length} artifact(s) from ${new Set(Object.keys(materials)).size} roles.`,
      decisionSummary: "Итоговый отчёт собран.",
    })).invoke(reportInput),
  );
  assert.equal(reportOutput.status, "success");
  await bus.publish(
    taskSucceeded(
      { tenantId, projectId, taskId: asTaskId("report-task"), roleId: asRoleId("report-generator") },
      [{ summary: "Итоговый отчёт собран." }],
    ),
  );
  await bus.publish(projectCompleted({ tenantId, projectId }));

  // --- The whole graph is complete ---
  assert.equal(isGraphComplete(graph, state), true);

  if (reportOutput.status === "success") {
    assert.equal(reportOutput.result.involvedRoles.length, 5); // research, ppc, media-buyer, analytics, qa
    assert.equal(Object.keys(reportOutput.result.materials).length, 5);
  }

  // --- Reflection: runs on the completed Project's real event history (Business Goals, Year-1 milestone) ---
  const reflectionResult = reflect(
    store,
    { kind: "reflection", tenantId },
    tenantId,
    projectId,
    log.entries.map((e) => e.event),
  );
  // Every Task here succeeded on the first try (Analytics' retry happened
  // inside the tool call, not as a Task-level Needs Revision/Failed event —
  // see Tool Integration §4 vs. Workflow Engine §4), so nothing here is
  // "noteworthy" per Reflection §4 — zero lessons is the correct, honest
  // result for a clean run, not a sign Reflection didn't do anything.
  assert.equal(reflectionResult.lessons.length, 0);
  assert.equal(reflectionResult.systemicFindings.length, 0);

  // --- Logging/Audit: every event that happened is in the journal, nothing skipped ---
  const journal = reconstructJournal(log.entries.map((e) => e.event));
  assert.equal(journal.length, 6); // one entry per Task node
  assert.ok(journal.every((entry) => entry.result === "success"));
  assert.ok(log.entries.some((e) => e.event.type === "plan_approved"));
  assert.ok(log.entries.some((e) => e.event.type === "project_completed"));
});
