import { randomUUID } from "node:crypto";
import {
  asProjectId,
  asRoleId,
  asTaskId,
  createInvocationContext,
  type AgentOutput,
  type ApprovalLevel,
  type ExecutionTier,
  type RoleId,
} from "@ama/agent-framework";
import {
  approvePlan as approvePlanState,
  initialGraphState,
  rejectPlan as rejectPlanState,
  statusAfterPlanBuilt,
} from "@ama/workflow-engine";
import { planApproved, planReady, planRejected, projectCreated } from "@ama/events";
import { createCeoAgent, prepareCeoInvocation, type CeoModelCaller } from "@ama/agent-ceo";
import { createPmAgent, preparePmInvocation, type PmModelCaller } from "@ama/agent-pm";
import { createResearchAgent, prepareResearchInvocation, type ResearchModelCaller } from "@ama/agent-research";
import { createSeoAgent, prepareSeoInvocation, type SeoModelCaller } from "@ama/agent-seo";
import { createPpcAgent, preparePpcInvocation, type PpcModelCaller } from "@ama/agent-ppc";
import {
  createMediaBuyerAgent,
  prepareMediaBuyerInvocation,
  type MediaBuyerModelCaller,
} from "@ama/agent-media-buyer";
import { createUxAgent, prepareUxInvocation, type UxModelCaller } from "@ama/agent-ux";
import {
  createUiDesignerAgent,
  prepareUiDesignerInvocation,
  type UiDesignerModelCaller,
} from "@ama/agent-ui-designer";
import {
  createCopywriterAgent,
  prepareCopywriterInvocation,
  type CopywriterModelCaller,
} from "@ama/agent-copywriter";
import { createFrontendAgent, prepareFrontendInvocation, type FrontendModelCaller } from "@ama/agent-frontend";
import { createAnalyticsAgent, prepareAnalyticsInvocation, type AnalyticsModelCaller } from "@ama/agent-analytics";
import { createQaAgent, prepareQaInvocation, type QaModelCaller } from "@ama/agent-qa";
import {
  createReportGeneratorAgent,
  prepareReportGeneratorInvocation,
  type ProjectOutput,
  type ReportMaterialRef,
  type ReportModelCaller,
} from "@ama/agent-report-generator";
import { AGENT_ACTOR, APPROVER, OWNER_TENANT_ID, getSingletons } from "./singletons.ts";
import { isAnthropicConfigured } from "./anthropic.ts";
import * as real from "./real-models.ts";
import { realToolInvoker } from "./real-tools.ts";
import {
  ROLE_OUTPUT,
  getProject,
  listProjects,
  projectsMap,
  relativeProjectMemoryKey,
  type ProjectInput,
  type ProjectRecord,
} from "./project-store.ts";

// Re-exported for existing route handlers, which import these from
// orchestrator.ts — the actual definitions now live in project-store.ts
// (split out so lib/workflows/execute-project.ts, a Workflow DevKit "use
// workflow" module, doesn't have to statically import this whole file, which
// transitively uses Node.js built-ins the workflow compiler rejects).
export { getProject, listProjects, ROLE_OUTPUT, type ProjectInput, type ProjectRecord };

// 2026-08-12 — a real ANTHROPIC_API_KEY was provided. USE_REAL_MODELS is
// evaluated once at module load: if a key is present, every role calls the
// actual model (lib/real-models.ts); if not, the fake* callers below still
// work, so the app degrades gracefully rather than crashing when no key is
// configured (e.g. CI, or a fresh clone without .env.local yet).
const USE_REAL_MODELS = isAnthropicConfigured();

// API/Application Layer §2 — the roles PM Agent is allowed to choose from
// (the reference conveyor, minus the service roles CEO/PM/Agent
// Architect/Reflection, which aren't things a Project's plan contains).
const AVAILABLE_ROLE_IDS: readonly RoleId[] = [
  "research",
  "seo",
  "ppc",
  "media-buyer",
  "ux",
  "ui-designer",
  "copywriter",
  "frontend",
  "analytics",
  "qa",
  "report-generator",
].map(asRoleId);

function ctx(record: ProjectRecord, taskId: string, roleId: string) {
  return createInvocationContext({
    tenantId: OWNER_TENANT_ID,
    projectId: record.projectId,
    taskId: asTaskId(taskId),
    roleId: asRoleId(roleId),
    executionTier: record.executionTier,
    approvalLevel: record.approvalLevel,
  });
}

// ---------------------------------------------------------------------
// Placeholder model callers. No LLM provider credentials exist in this
// environment (Roadmap: "какие реальные аккаунты нужны") — these stand in
// for Anthropic calls, deterministic and clearly not real reasoning. Every
// role package's own tests already prove the real handler logic works;
// this file only proves the *wiring* across all of them at once, through
// real HTTP endpoints.
// ---------------------------------------------------------------------

const fakeCeo: CeoModelCaller = async (_p, _m, input) => ({
  strategy: {
    strategySummary: `Приоритет: ${input.marketingTask}.`,
    priorityGoals: [input.marketingTask],
  },
  decisionSummary: `Стратегия определена по задаче: ${input.marketingTask}.`,
});

function fakePm(input: ProjectInput): PmModelCaller {
  const adsTask = /реклам|ads|campaign/i.test(input.marketingTask);
  return async () =>
    adsTask
      ? {
          selections: [
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
          ],
          decisionSummary: "Задача про рекламу — Research → PPC/Media Buyer → Analytics → QA → Report.",
        }
      : {
          selections: [
            { taskId: "research-task", roleId: asRoleId("research"), dependsOn: [] },
            { taskId: "copy-task", roleId: asRoleId("copywriter"), dependsOn: ["research-task"] },
            { taskId: "qa-task", roleId: asRoleId("qa"), dependsOn: ["copy-task"] },
            { taskId: "report-task", roleId: asRoleId("report-generator"), dependsOn: ["qa-task"] },
          ],
          decisionSummary: "Общая задача — Research → Copywriter → QA → Report.",
        };
}

const fakeResearch: ResearchModelCaller = async (_p, _m, site, search) => ({
  findings: { summary: "Собраны исходные данные.", facts: [String(site), String(search)] },
  decisionSummary: "Research завершён.",
});
const fakeSeo: SeoModelCaller = async () => ({
  recommendations: { targetKeywords: ["ключевое слово"], recommendations: ["добавить мета-описание"] },
  decisionSummary: "SEO-рекомендации сформированы.",
});
const fakePpc: PpcModelCaller = async () => ({
  result: { budgetSplit: { "google-ads": 0.6, "vk-ads": 0.4 } },
  decisionSummary: "Бюджет распределён 60/40 Google/VK.",
});
const fakeMediaBuyer: MediaBuyerModelCaller = async () => ({
  plan: { totalBudget: 1000, allocation: { "google-ads": 0.6, "vk-ads": 0.4 } },
  decisionSummary: "Общий бюджет спланирован.",
});
const fakeUx: UxModelCaller = async () => ({
  plan: { userFlows: ["browse -> product -> checkout"], structureNotes: "3-step funnel." },
  decisionSummary: "UX-план готов.",
});
const fakeUiDesigner: UiDesignerModelCaller = async () => ({
  design: { mockupRefs: ["mockup-1"], designNotes: "Clean, minimal." },
  decisionSummary: "Макет создан.",
});
function fakeCopywriter(input: ProjectInput): CopywriterModelCaller {
  return async () => ({
    draft: { texts: [`Draft for: ${input.marketingTask}`] },
    decisionSummary: "Тексты написаны.",
  });
}
const fakeFrontend: FrontendModelCaller = async (_p, _m, materials) => ({
  buildArtifact: { html: `<div>${Object.keys(materials).length} sections</div>` },
  decisionSummary: "Материалы собраны в статическую страницу.",
});
const fakeAnalytics: AnalyticsModelCaller = async () => ({
  report: { summary: "Показатели в норме.", metrics: { ctr: 0.05 } },
  decisionSummary: "Отчёт по аналитике готов.",
});
const fakeQa: QaModelCaller = async () => ({
  verdict: { approved: true, issues: [] },
  decisionSummary: "Результат проверен и одобрен.",
});
const fakeReport: ReportModelCaller = async (_p, _m, materials) => ({
  narrativeSummary: `Собрано ${Object.keys(materials).length} материал(ов).`,
  decisionSummary: "Итоговый отчёт собран.",
});

// ---------------------------------------------------------------------

export async function createProject(
  input: ProjectInput,
  approvalLevel: ApprovalLevel = "strategy-gate",
  executionTier: ExecutionTier = "standard",
): Promise<ProjectRecord> {
  const { bus } = getSingletons();
  const projectId = asProjectId(randomUUID());
  await bus.publish(projectCreated({ tenantId: OWNER_TENANT_ID, projectId }));

  const record: ProjectRecord = {
    projectId,
    input,
    approvalLevel,
    executionTier,
    planStatus: "building",
    rejectionComments: [],
    reworkComments: [],
    createdAt: Date.now(),
  };
  projectsMap().set(projectId, record);

  await runPlanning(record);
  return record;
}

async function runPlanning(record: ProjectRecord): Promise<void> {
  const { store, registry, credentials, catalog, bus } = getSingletons();

  const { agentInput: ceoInput } = prepareCeoInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("ceo"), version: 1, purpose: "CEO", responsibility: "CEO only" },
    context: ctx(record, "ceo-task", "ceo"),
    taskDescription: "Определить стратегию для Project.",
    siteUrl: record.input.siteUrl,
    businessDescription: record.input.businessDescription,
    product: record.input.product,
    marketingTask: record.input.marketingTask,
    complexity: "standard",
    invokeTool: async () => "unused",
  });
  const ceoOutput = await createCeoAgent(USE_REAL_MODELS ? real.realCeo : fakeCeo).invoke(ceoInput);
  if (ceoOutput.status !== "success") {
    throw new Error(`CEO planning failed: ${ceoOutput.status === "failed" ? ceoOutput.error.message : "needs revision"}`);
  }

  const { agentInput: pmInput } = preparePmInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: { roleId: asRoleId("pm"), version: 1, purpose: "PM", responsibility: "PM only" },
    context: ctx(record, "pm-task", "pm"),
    taskDescription: "Построить план исполнения.",
    availableRoleIds: AVAILABLE_ROLE_IDS,
    strategySummary: ceoOutput.result.strategySummary,
    complexity: "standard",
    invokeTool: async () => "unused",
  });
  const pmOutput = await createPmAgent(
    USE_REAL_MODELS ? real.realPm(AVAILABLE_ROLE_IDS) : fakePm(record.input),
  ).invoke(pmInput);
  if (pmOutput.status !== "success") {
    throw new Error(`PM planning failed: ${pmOutput.status === "failed" ? pmOutput.error.message : "needs revision"}`);
  }

  record.graph = pmOutput.result;
  record.graphState = initialGraphState(pmOutput.result);
  record.planSummary = pmOutput.decisions[0]?.summary;
  record.planStatus = statusAfterPlanBuilt(record.approvalLevel);
  await bus.publish(planReady({ tenantId: OWNER_TENANT_ID, projectId: record.projectId }));
}

export function approveProject(record: ProjectRecord): void {
  record.planStatus = approvePlanState(record.planStatus);
}

export async function rejectAndReplan(record: ProjectRecord, comment: string): Promise<void> {
  record.planStatus = rejectPlanState(record.planStatus);
  record.rejectionComments.push(comment);
  const { bus } = getSingletons();
  await bus.publish(planRejected({ tenantId: OWNER_TENANT_ID, projectId: record.projectId }, comment));
  await runPlanning(record); // Workflow Engine §3: PM Agent rebuilds the plan.
}

// Dispatches a single Task to its real role package. This switch is the
// one place in the whole codebase that has to know about every role at
// once — every other package only knows its own contract. Exported so
// lib/workflows/execute-project.ts's steps can call it.
export async function runNode(
  record: ProjectRecord,
  node: { taskId: string; roleId: string; dependsOn: readonly string[] },
): Promise<AgentOutput<unknown>> {
  const { store, registry, credentials, catalog } = getSingletons();
  const c = ctx(record, node.taskId, node.roleId);
  const projectContextKeys = node.dependsOn.map((depTaskId) => {
    const depNode = record.graph?.nodes.find((n) => n.taskId === depTaskId);
    return depNode ? relativeProjectMemoryKey(depNode.roleId, depTaskId) : depTaskId;
  });

  switch (node.roleId) {
    case "research": {
      const { agentInput } = prepareResearchInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "Research", responsibility: "Research only" },
        context: c, taskDescription: "Собрать данные о сайте и рынке.",
        siteUrl: record.input.siteUrl, searchQuery: record.input.marketingTask,
        complexity: record.executionTier === "fast" ? "routine" : "standard",
        invokeTool: realToolInvoker,
      });
      return createResearchAgent(USE_REAL_MODELS ? real.realResearch : fakeResearch).invoke(agentInput);
    }
    case "seo": {
      const { agentInput } = prepareSeoInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "SEO", responsibility: "SEO only" },
        context: c, taskDescription: "Сформировать SEO-рекомендации.", clientFactKeys: [],
        siteUrl: record.input.siteUrl, complexity: "standard", invokeTool: async () => ({}),
      });
      return createSeoAgent(USE_REAL_MODELS ? real.realSeo : fakeSeo).invoke(agentInput);
    }
    case "ppc": {
      const { agentInput } = preparePpcInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "PPC", responsibility: "PPC only" },
        context: c, taskDescription: "Настроить рекламные кампании.", clientFactKeys: [],
        channels: ["google-ads", "vk-ads", "yandex-direct", "meta-ads"], complexity: "standard", invokeTool: realToolInvoker,
        googleAdsCustomerId: record.input.googleAdsCustomerId,
        yandexClientLogin: record.input.yandexClientLogin,
        metaAdAccountId: record.input.metaAdAccountId,
        siteUrl: record.input.siteUrl,
      });
      return createPpcAgent(USE_REAL_MODELS ? real.realPpc : fakePpc).invoke(agentInput);
    }
    case "media-buyer": {
      const { agentInput } = prepareMediaBuyerInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "MB", responsibility: "MB only" },
        context: c, taskDescription: "Спланировать медиа-бюджет.", clientFactKeys: [],
        complexity: "standard", invokeTool: async () => "unused",
      });
      return createMediaBuyerAgent(USE_REAL_MODELS ? real.realMediaBuyer : fakeMediaBuyer).invoke(agentInput);
    }
    case "ux": {
      const { agentInput } = prepareUxInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "UX", responsibility: "UX only" },
        context: c, taskDescription: "Проработать пользовательские сценарии.", clientFactKeys: [],
        complexity: "standard", invokeTool: async () => "unused",
      });
      return createUxAgent(USE_REAL_MODELS ? real.realUx : fakeUx).invoke(agentInput);
    }
    case "ui-designer": {
      const { agentInput } = prepareUiDesignerInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "UI", responsibility: "UI only" },
        context: c, taskDescription: "Создать макеты.", clientFactKeys: [], projectContextKeys,
        complexity: "standard", invokeTool: async () => ({}),
      });
      return createUiDesignerAgent(USE_REAL_MODELS ? real.realUiDesigner : fakeUiDesigner).invoke(agentInput);
    }
    case "copywriter": {
      const { agentInput } = prepareCopywriterInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "Copy", responsibility: "Copy only" },
        context: c, taskDescription: "Написать тексты.", clientFactKeys: [],
        briefs: [record.input.marketingTask], complexity: "routine", invokeTool: async () => "unused",
      });
      return createCopywriterAgent(USE_REAL_MODELS ? real.realCopywriter : fakeCopywriter(record.input)).invoke(
        agentInput,
      );
    }
    case "frontend": {
      const { agentInput } = prepareFrontendInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "Frontend", responsibility: "Frontend only" },
        context: c, taskDescription: "Опубликовать материалы.", materials: {},
        complexity: "standard", invokeTool: async () => ({ url: "https://dev-placeholder.example" }),
      });
      return createFrontendAgent(USE_REAL_MODELS ? real.realFrontend : fakeFrontend).invoke(agentInput);
    }
    case "analytics": {
      const { agentInput } = prepareAnalyticsInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "Analytics", responsibility: "Analytics only" },
        context: c, taskDescription: "Оценить эффективность кампаний.", clientFactKeys: [], projectContextKeys,
        complexity: "standard", invokeTool: realToolInvoker,
        projectDisplayName: `AMA — ${record.projectId}`, siteUrl: record.input.siteUrl,
        gtmAccountId: record.input.gtmAccountId, gaAccountId: record.input.gaAccountId,
        googleAdsCustomerId: record.input.googleAdsCustomerId,
      });
      return createAnalyticsAgent(USE_REAL_MODELS ? real.realAnalytics : fakeAnalytics).invoke(agentInput);
    }
    case "qa": {
      const depKey = projectContextKeys[0];
      const artifactToReview = depKey
        ? store.read(AGENT_ACTOR, { level: "project", tenantId: OWNER_TENANT_ID, key: `${record.projectId}:${depKey}` })
        : undefined;
      const { agentInput } = prepareQaInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "QA", responsibility: "QA only" },
        context: c, taskDescription: "Проверить результат по чек-листу.",
        artifactToReview, checklistId: "general-checklist",
        complexity: "routine", invokeTool: async () => "unused",
      });
      return createQaAgent(USE_REAL_MODELS ? real.realQa : fakeQa).invoke(agentInput);
    }
    case "report-generator": {
      const materialRefs: ReportMaterialRef[] = (record.graph?.nodes ?? [])
        .filter((n) => n.taskId !== node.taskId && n.roleId !== "qa")
        .map((n) => ({ roleId: n.roleId, key: relativeProjectMemoryKey(n.roleId, n.taskId) }));
      const { agentInput } = prepareReportGeneratorInvocation({
        store, registry, credentials, catalog,
        template: { roleId: c.roleId, version: 1, purpose: "Report", responsibility: "Report only" },
        context: c, taskDescription: "Собрать итоговый отчёт.", materialRefs,
        complexity: "routine", invokeTool: async () => "unused",
      });
      return createReportGeneratorAgent(USE_REAL_MODELS ? real.realReport : fakeReport).invoke(agentInput);
    }
    default:
      throw new Error(`No dispatcher wired for role "${node.roleId}"`);
  }
}

// Graph execution moved to lib/workflows/execute-project.ts (a real
// Workflow DevKit durable workflow, started via start() from the approve
// route) — this file no longer runs the graph itself. See that module for
// the retry/escalate/block Recovery wiring and finalize* steps that replace
// what a single synchronous executeGraph() used to do inline here.

// Flips the plan to "executing" and publishes planApproved — kept as a
// fast, synchronous step in the approve route's own request (unlike graph
// execution, this has no reason to be a durable step).
export async function approveProjectAndPublish(record: ProjectRecord): Promise<void> {
  const { bus } = getSingletons();
  approveProject(record);
  await bus.publish(planApproved({ tenantId: OWNER_TENANT_ID, projectId: record.projectId }));
}

// FR-5 — simplified: re-runs only Report Generator against the current
// materials, rather than figuring out which upstream Tasks are actually
// affected by the comment (real PM-driven re-decomposition, not built
// here — see docs/03-architecture/api-application-layer.md §4a).
export async function requestRework(record: ProjectRecord, comment: string): Promise<void> {
  if (record.planStatus !== "completed" || !record.graph) {
    throw new Error("Rework is only available for a completed Project");
  }
  record.reworkComments.push(comment);
  const reportNode = record.graph.nodes.find((n) => n.roleId === "report-generator");
  if (!reportNode) throw new Error("No report-generator Task in this Project's graph");
  const output = await runNode(record, reportNode);
  if (output.status === "success") {
    record.output = output.result as ProjectOutput;
  }
}

export { APPROVER };
