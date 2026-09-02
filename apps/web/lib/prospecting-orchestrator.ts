import { asProjectId, asRoleId, asTaskId, createInvocationContext, type AgentOutput } from "@ama/agent-framework";
import { buildGraph, getReadyNodes, initialGraphState, isGraphComplete, withNodeState, type WorkflowNode } from "@ama/workflow-engine";
import { createLeadFinderAgent, prepareLeadFinderInvocation } from "@ama/agent-lead-finder";
import { createAgencyResearcherAgent, prepareAgencyResearcherInvocation } from "@ama/agent-agency-researcher";
import { createDecisionMakerFinderAgent, prepareDecisionMakerFinderInvocation } from "@ama/agent-decision-maker-finder";
import { createLeadScorerAgent, prepareLeadScorerInvocation } from "@ama/agent-lead-scorer";
import { createOutreachCopywriterAgent, prepareOutreachCopywriterInvocation } from "@ama/agent-outreach-copywriter";
import { createComplianceCheckerAgent, prepareComplianceCheckerInvocation } from "@ama/agent-compliance-checker";
import { createReplyClassifierAgent, prepareReplyClassifierInvocation } from "@ama/agent-reply-classifier";
import { OWNER_TENANT_ID, getSingletons } from "./singletons.ts";
import { isAnthropicConfigured } from "./anthropic.ts";
import { realToolInvoker } from "./real-tools.ts";
import * as real from "./real-models-track-a.ts";

// Track A (client acquisition) orchestration — plan §"Архитектурное
// решение: свой оркестратор для обоих треков". Deliberately does NOT go
// through createProject()/CEO/PM (orchestrator.ts): that path plans a
// one-shot "here's a site, run the reference conveyor" Project, which
// doesn't fit "find N leads, run each through a fixed pipeline, repeat
// forever." Instead this drives @ama/workflow-engine's buildGraph()/
// getReadyNodes() directly against a small, FIXED graph shape (no PM
// planning step needed — the shape never changes), reusing 100% of
// agent-framework/workflow-engine/tools/memory/cost-router.

const USE_REAL_MODELS = isAnthropicConfigured();

const fakeLeadFinder: import("@ama/agent-lead-finder").LeadFinderModelCaller = async () => ({
  candidates: [],
  decisionSummary: "Нет ANTHROPIC_API_KEY — поиск не выполнен.",
});
const fakeAgencyResearcher: import("@ama/agent-agency-researcher").AgencyResearcherModelCaller = async () => ({
  facts: [],
  decisionSummary: "Нет ANTHROPIC_API_KEY — исследование не выполнено.",
});
const fakeDecisionMakerFinder: import("@ama/agent-decision-maker-finder").DecisionMakerFinderModelCaller = async () => ({
  decisionMakers: [],
  decisionSummary: "Нет ANTHROPIC_API_KEY — поиск контактов не выполнен.",
});
const fakeLeadScorer: import("@ama/agent-lead-scorer").LeadScorerModelCaller = async () => ({
  score: 0,
  scoreBreakdown: {},
  decisionSummary: "Нет ANTHROPIC_API_KEY — скоринг не выполнен.",
});
const fakeOutreachCopywriter: import("@ama/agent-outreach-copywriter").OutreachCopywriterModelCaller = async () => ({
  subject: "",
  bodyText: "",
  decisionSummary: "Нет ANTHROPIC_API_KEY — черновик не написан.",
});
const fakeReplyClassifier: import("@ama/agent-reply-classifier").ReplyClassifierModelCaller = async () => ({
  category: "other",
  confidence: "low",
  decisionSummary: "Нет ANTHROPIC_API_KEY — классификация не выполнена.",
});

function ctx(prospectAgencyId: string, taskId: string, roleId: string) {
  // Reuses the prospect's own id as a pseudo-projectId, purely to scope
  // Task/Project memory per prospect (agent-port.ts namespaces memory keys
  // by taskId:/projectId:) — Track A prospects aren't Projects in
  // project-store.ts's sense and don't need to be.
  return createInvocationContext({
    tenantId: OWNER_TENANT_ID,
    projectId: asProjectId(prospectAgencyId),
    taskId: asTaskId(taskId),
    roleId: asRoleId(roleId),
    executionTier: "standard",
    approvalLevel: "strategy-gate",
  });
}

export interface LeadDiscoveryInput {
  readonly countries: readonly string[];
  readonly seedQueries?: readonly string[];
}

export interface LeadDiscoveryResult {
  readonly prospectAgencyIds: readonly string[];
  readonly decisionSummary: string;
}

export async function runLeadDiscovery(input: LeadDiscoveryInput): Promise<LeadDiscoveryResult> {
  const { store, registry, credentials, catalog } = getSingletons();
  const runId = `lead-discovery-${Date.now()}`;
  const { agentInput } = prepareLeadFinderInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("lead-finder"), version: 1, purpose: "Lead Finder", responsibility: "Lead Finder only" },
    context: ctx(runId, "discovery", "lead-finder"),
    taskDescription: "Найти digital-агентства, подходящие под ICP white-label PPC партнёрства.",
    countries: input.countries,
    seedQueries: input.seedQueries,
    complexity: "standard",
    invokeTool: realToolInvoker,
  });
  const output = await createLeadFinderAgent(USE_REAL_MODELS ? real.realLeadFinder : fakeLeadFinder).invoke(agentInput);
  if (output.status !== "success") {
    throw new Error(`Lead discovery failed: ${output.status === "failed" ? output.error.message : output.reason}`);
  }
  return { prospectAgencyIds: output.result.prospectAgencyIds, decisionSummary: output.decisions[0]?.summary ?? "" };
}

interface ProspectPipelineState {
  decisionMakerId?: string;
  outreachMessageId?: string;
}

async function runProspectNode(
  node: WorkflowNode,
  prospectAgencyId: string,
  websiteUrl: string,
  pipelineState: ProspectPipelineState,
): Promise<AgentOutput<unknown>> {
  const { store, registry, credentials, catalog } = getSingletons();
  const c = ctx(prospectAgencyId, node.taskId, node.roleId);

  switch (node.roleId) {
    case "agency-researcher": {
      const { agentInput } = prepareAgencyResearcherInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "Agency Researcher", responsibility: "Research only" },
        context: c, taskDescription: "Изучить сайт агентства-проспекта.",
        prospectAgencyId, websiteUrl, complexity: "standard", invokeTool: realToolInvoker,
      });
      return createAgencyResearcherAgent(USE_REAL_MODELS ? real.realAgencyResearcher : fakeAgencyResearcher).invoke(agentInput);
    }
    case "decision-maker-finder": {
      const { agentInput } = prepareDecisionMakerFinderInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "Decision Maker Finder", responsibility: "Contact search only" },
        context: c, taskDescription: "Найти decision maker в агентстве-проспекте.",
        prospectAgencyId, websiteUrl, complexity: "standard", invokeTool: realToolInvoker,
      });
      return createDecisionMakerFinderAgent(USE_REAL_MODELS ? real.realDecisionMakerFinder : fakeDecisionMakerFinder).invoke(agentInput);
    }
    case "lead-scorer": {
      const { agentInput } = prepareLeadScorerInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "Lead Scorer", responsibility: "Scoring only" },
        context: c, taskDescription: "Оценить проспекта как кандидата в white-label партнёры.",
        prospectAgencyId, complexity: "standard", invokeTool: realToolInvoker,
      });
      return createLeadScorerAgent(USE_REAL_MODELS ? real.realLeadScorer : fakeLeadScorer).invoke(agentInput);
    }
    case "outreach-copywriter": {
      const { agentInput } = prepareOutreachCopywriterInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "Outreach Copywriter", responsibility: "Drafting only" },
        context: c, taskDescription: "Написать персонализированный черновик outreach-письма.",
        prospectAgencyId, decisionMakerId: pipelineState.decisionMakerId, complexity: "standard", invokeTool: realToolInvoker,
      });
      return createOutreachCopywriterAgent(USE_REAL_MODELS ? real.realOutreachCopywriter : fakeOutreachCopywriter).invoke(agentInput);
    }
    case "compliance-checker": {
      if (!pipelineState.outreachMessageId) {
        return { status: "failed", error: { code: "MISSING_DRAFT", message: "No outreachMessageId to check.", retryable: false } };
      }
      const { agentInput } = prepareComplianceCheckerInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "Compliance Checker", responsibility: "Compliance gate only" },
        context: c, taskDescription: "Проверить черновик перед одобрением человеком.",
        outreachMessageId: pipelineState.outreachMessageId, complexity: "routine", invokeTool: realToolInvoker,
      });
      return createComplianceCheckerAgent().invoke(agentInput);
    }
    default:
      throw new Error(`No dispatcher wired for Track A role "${node.roleId}"`);
  }
}

export interface ProspectPipelineResult {
  readonly outreachMessageId?: string;
  readonly disqualified: boolean;
  readonly complianceOutcome?: "approved" | "suppressed" | "revision_needed";
}

// Runs one prospect (already created by runLeadDiscovery) through
// research -> decision-maker search -> scoring -> (if qualified) drafting
// -> compliance check. Short-circuits on disqualification — the rest of
// the graph simply never becomes "ready" once "score" doesn't unblock it
// (getReadyNodes only advances along dependsOn edges that succeeded), so no
// special engine feature is needed for the short-circuit itself; this loop
// just also stops iterating once it observes the disqualified flag, so a
// wasted extra pass isn't attempted.
export async function runProspectPipeline(prospectAgencyId: string, websiteUrl: string): Promise<ProspectPipelineResult> {
  const graph = buildGraph([
    { taskId: "research", roleId: asRoleId("agency-researcher"), dependsOn: [] },
    { taskId: "decision-maker", roleId: asRoleId("decision-maker-finder"), dependsOn: [] },
    { taskId: "score", roleId: asRoleId("lead-scorer"), dependsOn: ["research", "decision-maker"] },
    { taskId: "draft", roleId: asRoleId("outreach-copywriter"), dependsOn: ["score"] },
    { taskId: "compliance", roleId: asRoleId("compliance-checker"), dependsOn: ["draft"] },
  ]);

  let state = initialGraphState(graph);
  const pipelineState: ProspectPipelineState = {};
  let disqualified = false;
  let complianceOutcome: "approved" | "suppressed" | "revision_needed" | undefined;

  while (!isGraphComplete(graph, state) && !disqualified) {
    const ready = getReadyNodes(graph, state);
    if (ready.length === 0) break;

    for (const node of ready) {
      const output = await runProspectNode(node, prospectAgencyId, websiteUrl, pipelineState);
      if (output.status !== "success") {
        state = withNodeState(state, node.taskId, output.status === "needs_revision" ? "needs_revision" : "failed");
        continue;
      }
      state = withNodeState(state, node.taskId, "succeeded");

      if (node.taskId === "decision-maker") {
        pipelineState.decisionMakerId = (output.result as { decisionMakerIds: readonly string[] }).decisionMakerIds[0];
      }
      if (node.taskId === "score" && (output.result as { disqualified: boolean }).disqualified) {
        disqualified = true;
      }
      if (node.taskId === "draft") {
        pipelineState.outreachMessageId = (output.result as { outreachMessageId: string }).outreachMessageId;
      }
      if (node.taskId === "compliance") {
        complianceOutcome = (output.result as { outcome: "approved" | "suppressed" | "revision_needed" }).outcome;
      }
    }
  }

  return { outreachMessageId: pipelineState.outreachMessageId, disqualified, complianceOutcome };
}

export interface ClassifyReplyResult {
  readonly category: string;
  readonly confidence: string;
}

// The manual-logging fallback path (Plan §1.3 — inbound MX routing isn't
// live yet): a human pastes a reply's text in, this classifies it exactly
// as the future webhook path will.
export async function classifyReply(outreachMessageId: string, replyText: string): Promise<ClassifyReplyResult> {
  const { store, registry, credentials, catalog } = getSingletons();
  const { agentInput } = prepareReplyClassifierInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("reply-classifier"), version: 1, purpose: "Reply Classifier", responsibility: "Classification only" },
    context: ctx(outreachMessageId, "classify", "reply-classifier"),
    taskDescription: "Классифицировать входящий ответ.",
    outreachMessageId, replyText, complexity: "routine", invokeTool: realToolInvoker,
  });
  const output = await createReplyClassifierAgent(USE_REAL_MODELS ? real.realReplyClassifier : fakeReplyClassifier).invoke(agentInput);
  if (output.status !== "success") {
    throw new Error(`Reply classification failed: ${output.status === "failed" ? output.error.message : output.reason}`);
  }
  return output.result;
}
