// Pilot run of the real agent chain against a prospective client
// (https://mayakdent.by/), requested by the Owner as a scoping run for a
// commercial proposal (KP): research + strategy + media plan focused on
// two service lines the client wants a min/max budget estimate for —
// протезирование (prosthetics) and имплантация (implants). Same safety
// contract as belseltur-pilot-run.ts: real research/model calls, but
// NOTHING that creates or configures a real external ad account is
// allowed to run (no Google Ads/Meta Ads campaign creation, no
// analytics/GTM provisioning).
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/mayakdent-pilot-run.ts
import { writeFileSync } from "node:fs";
import {
  asTenantId,
  asProjectId,
  asTaskId,
  asRoleId,
  createInvocationContext,
} from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { ToolRegistry, CredentialStore, type ToolInvoker } from "@ama/tools";
import { createAnthropicModelCatalog } from "@ama/cost-router";

import { createCeoAgent, prepareCeoInvocation } from "@ama/agent-ceo";
import { createPmAgent, preparePmInvocation } from "@ama/agent-pm";
import { createResearchAgent, prepareResearchInvocation } from "@ama/agent-research";
import { createMediaBuyerAgent, prepareMediaBuyerInvocation } from "@ama/agent-media-buyer";
import { createPpcAgent, preparePpcInvocation } from "@ama/agent-ppc";
import { createCopywriterAgent, prepareCopywriterInvocation } from "@ama/agent-copywriter";
import { createQaAgent, prepareQaInvocation } from "@ama/agent-qa";
import { createReportGeneratorAgent, prepareReportGeneratorInvocation } from "@ama/agent-report-generator";

import {
  realCeo,
  realPm,
  realResearch,
  realMediaBuyer,
  realPpc,
  realCopywriter,
  realQa,
  realReport,
} from "../lib/real-models.ts";
import { realToolInvoker } from "../lib/real-tools.ts";

const TENANT_ID = asTenantId("owner");
const APPROVER: Actor = { kind: "approver", tenantId: TENANT_ID };
const AGENT_ACTOR: Actor = { kind: "agent", tenantId: TENANT_ID };
const PROJECT_ID = asProjectId("mayakdent-pilot-2026-09-02");

const SITE_URL = "https://mayakdent.by/";

interface LogEntry {
  readonly seq: number;
  readonly kind: "agent-call" | "tool-call";
  readonly from: string;
  readonly to: string;
  readonly asked: unknown;
  readonly answered: unknown;
  readonly note?: string;
}
const commLog: LogEntry[] = [];
let seq = 0;
function logAgent(from: string, to: string, asked: unknown, answered: unknown, note?: string) {
  commLog.push({ seq: seq++, kind: "agent-call", from, to, asked, answered, note });
}
function logTool(from: string, to: string, asked: unknown, answered: unknown, note?: string) {
  commLog.push({ seq: seq++, kind: "tool-call", from, to, asked, answered, note });
}

const store = new MemoryStore();
const registry = new ToolRegistry();
const credentials = new CredentialStore();
const catalog = createAnthropicModelCatalog();

const TOOL_IDS = [
  "site-reader", "web-search", "seo-service", "google-ads", "vk-ads",
  "yandex-direct", "meta-ads", "google-analytics", "yandex-metrika",
  "datalens", "design-tool", "deployment-tool", "creative-generation", "client-context",
];
for (const toolId of TOOL_IDS) {
  registry.register(APPROVER, { toolId, displayName: toolId });
  credentials.issue(APPROVER, toolId, `dev-placeholder-token-${toolId}`);
}

const SAFE_REAL_TOOLS = new Set(["site-reader", "web-search"]);

const guardedInvoker: ToolInvoker = async (toolId, args) => {
  if (SAFE_REAL_TOOLS.has(toolId)) {
    try {
      const result = await realToolInvoker(toolId, args);
      logTool("agent", toolId, args, result, "real call, read-only, executed");
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logTool("agent", toolId, args, { error: msg }, "REAL CALL FAILED — provider returned an error, not simulated");
      return `[${toolId} unavailable: ${msg}]`;
    }
  }
  const blocked = {
    blocked: true,
    reason: "Owner instruction for this run: no account creation/configuration. Not executed.",
  };
  logTool("agent", toolId, args, blocked, "BLOCKED — would have called the real API, did not");
  return blocked;
};

function ctx(taskId: string, roleId: string) {
  return createInvocationContext({
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    taskId: asTaskId(taskId),
    roleId: asRoleId(roleId),
    executionTier: "standard",
    approvalLevel: "strategy-gate",
  });
}

async function main() {
  console.log("=== 1/8 Research: real site fetch + real Perplexity web search ===");
  const { agentInput: researchInput } = prepareResearchInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("research"), version: 1, purpose: "Research", responsibility: "Research only" },
    context: ctx("research-task", "research"),
    taskDescription: "Изучить сайт стоматологической клиники (Беларусь) и рынок стоматологических услуг, с фокусом на двух направлениях — протезирование зубов и имплантация. Собрать факты для оценки объёма работ и медиаплана по Google Ads и Яндекс.Директ.",
    siteUrl: SITE_URL,
    searchQuery: "стоматология Беларусь протезирование имплантация зубов реклама конверсия CPL",
    complexity: "standard",
    invokeTool: guardedInvoker,
  });
  const researchOut = await createResearchAgent(realResearch).invoke(researchInput);
  logAgent("Owner", "Research Agent", researchInput.task.description, researchOut.status === "success" ? researchOut.decisions : researchOut);
  if (researchOut.status !== "success") throw new Error("Research failed: " + JSON.stringify(researchOut));
  store.archiveTaskIntoProject(AGENT_ACTOR, "research-task", PROJECT_ID);
  console.log(JSON.stringify(researchOut.result, null, 2));

  const findingsSummary = researchOut.result.summary;
  const findingsFacts = researchOut.result.facts.join("\n- ");

  console.log("\n=== 2/8 CEO: strategy ===");
  const { agentInput: ceoInput } = prepareCeoInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("ceo"), version: 1, purpose: "CEO", responsibility: "CEO only" },
    context: ctx("ceo-task", "ceo"),
    taskDescription: "Определить стратегию продвижения стоматологической клиники по двум направлениям (протезирование, имплантация) на основе реального ресёрча, с ориентиром на диапазон бюджета мин-макс.",
    siteUrl: SITE_URL,
    businessDescription: `Ресёрч Research Agent:\n${findingsSummary}\n\nФакты:\n- ${findingsFacts}`,
    product: "Стоматологические услуги: протезирование зубов и имплантация (согласно сайту клиники)",
    marketingTask: "Стратегия продвижения через Google Ads и Яндекс.Директ по двум направлениям (протезирование, имплантация), с медиапланом и диапазоном бюджета мин-макс, ориентировочными показателями конверсии и стоимости лида по нише",
    complexity: "standard",
    invokeTool: guardedInvoker,
  });
  const ceoOut = await createCeoAgent(realCeo).invoke(ceoInput);
  logAgent("Owner", "CEO Agent", ceoInput.task.description, ceoOut.status === "success" ? { result: ceoOut.result, decisions: ceoOut.decisions } : ceoOut);
  if (ceoOut.status !== "success") throw new Error("CEO failed: " + JSON.stringify(ceoOut));
  store.archiveTaskIntoProject(AGENT_ACTOR, "ceo-task", PROJECT_ID);
  console.log(JSON.stringify(ceoOut.result, null, 2));

  console.log("\n=== 3/8 PM: task graph ===");
  const AVAILABLE_ROLE_IDS = [
    "research", "seo", "ppc", "media-buyer", "ux", "ui-designer",
    "copywriter", "creative", "frontend", "analytics", "qa", "report-generator",
  ].map(asRoleId);
  const { agentInput: pmInput } = preparePmInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("pm"), version: 1, purpose: "PM", responsibility: "PM only" },
    context: ctx("pm-task", "pm"),
    taskDescription: "Построить план исполнения для стратегии продвижения (Google Ads + Яндекс.Директ).",
    availableRoleIds: AVAILABLE_ROLE_IDS,
    strategySummary: ceoOut.result.strategySummary,
    complexity: "standard",
    invokeTool: guardedInvoker,
  });
  const pmOut = await createPmAgent(realPm(AVAILABLE_ROLE_IDS)).invoke(pmInput);
  logAgent("CEO Agent", "PM Agent", pmInput.task.description, pmOut.status === "success" ? { result: pmOut.result, decisions: pmOut.decisions } : pmOut);
  if (pmOut.status !== "success") throw new Error("PM failed: " + JSON.stringify(pmOut));
  console.log(JSON.stringify(pmOut.result, null, 2));

  console.log("\n=== 4/8 Media Buyer: overall budget plan (min/max) ===");
  const { agentInput: mbInput } = prepareMediaBuyerInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("media-buyer"), version: 1, purpose: "MB", responsibility: "MB only" },
    context: ctx("media-buyer-task", "media-buyer"),
    taskDescription: `Спланировать общий медиа-бюджет (Google Ads + Яндекс.Директ) для стоматологической клиники, отдельно по протезированию и имплантации, с диапазоном мин-макс. Стратегия: ${ceoOut.result.strategySummary}. Ресёрч: ${findingsSummary}`,
    clientFactKeys: [],
    complexity: "standard",
    invokeTool: guardedInvoker,
  });
  const mbOut = await createMediaBuyerAgent(realMediaBuyer).invoke(mbInput);
  logAgent("PM Agent", "Media Buyer Agent", mbInput.task.description, mbOut.status === "success" ? { result: mbOut.result, decisions: mbOut.decisions } : mbOut);
  if (mbOut.status !== "success") throw new Error("Media Buyer failed: " + JSON.stringify(mbOut));
  store.archiveTaskIntoProject(AGENT_ACTOR, "media-buyer-task", PROJECT_ID);
  console.log(JSON.stringify(mbOut.result, null, 2));

  console.log("\n=== 5/8 PPC: channel budget split (reasoning only — tool calls BLOCKED) ===");
  const { agentInput: ppcInput } = preparePpcInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("ppc"), version: 1, purpose: "PPC", responsibility: "PPC only" },
    context: ctx("ppc-task", "ppc"),
    taskDescription: `Распределить бюджет между Google Ads и Яндекс.Директ, отдельно на протезирование и имплантацию (без запуска/создания кампаний — только план и структура). Общий бюджет: ${mbOut.result.totalBudget}.`,
    clientFactKeys: [],
    channels: ["google-ads", "yandex-direct"],
    complexity: "standard",
    invokeTool: guardedInvoker,
    siteUrl: SITE_URL,
  });
  const ppcOut = await createPpcAgent(realPpc).invoke(ppcInput);
  logAgent("Media Buyer Agent", "PPC Agent", ppcInput.task.description, ppcOut.status === "success" ? { result: ppcOut.result, decisions: ppcOut.decisions } : ppcOut);
  if (ppcOut.status !== "success") throw new Error("PPC failed: " + JSON.stringify(ppcOut));
  store.archiveTaskIntoProject(AGENT_ACTOR, "ppc-task", PROJECT_ID);
  console.log(JSON.stringify(ppcOut.result, null, 2));

  console.log("\n=== 6/8 Copywriter: messaging ideas ===");
  const { agentInput: copyInput } = prepareCopywriterInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("copywriter"), version: 1, purpose: "Copy", responsibility: "Copy only" },
    context: ctx("copy-task", "copywriter"),
    taskDescription: "Предложить 3-5 вариантов рекламных заголовков/сообщений для Google Ads и Яндекс.Директ отдельно по протезированию и имплантации, на основе ресёрча и стратегии.",
    clientFactKeys: [],
    briefs: [findingsSummary, ceoOut.result.strategySummary],
    complexity: "routine",
    invokeTool: guardedInvoker,
  });
  const copyOut = await createCopywriterAgent(realCopywriter).invoke(copyInput);
  logAgent("PM Agent", "Copywriter Agent", copyInput.task.description, copyOut.status === "success" ? { result: copyOut.result, decisions: copyOut.decisions } : copyOut);
  if (copyOut.status !== "success") throw new Error("Copywriter failed: " + JSON.stringify(copyOut));
  store.archiveTaskIntoProject(AGENT_ACTOR, "copy-task", PROJECT_ID);
  console.log(JSON.stringify(copyOut.result, null, 2));

  console.log("\n=== 7/8 QA: review the assembled media plan ===");
  const artifactToReview = {
    strategy: ceoOut.result,
    research: researchOut.result,
    mediaBudget: mbOut.result,
    ppcSplit: ppcOut.result,
    copy: copyOut.result,
  };
  const { agentInput: qaInput } = prepareQaInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("qa"), version: 1, purpose: "QA", responsibility: "QA only" },
    context: ctx("qa-task", "qa"),
    taskDescription: "Проверить целостность и адекватность стратегии, медиаплана и текстов перед отправкой владельцу для подготовки КП.",
    artifactToReview,
    checklistId: "general-checklist",
    complexity: "routine",
    invokeTool: guardedInvoker,
  });
  const qaOut = await createQaAgent(realQa).invoke(qaInput);
  logAgent("PM Agent", "QA Agent", qaInput.task.description, qaOut.status === "success" ? { result: qaOut.result, decisions: qaOut.decisions } : qaOut);
  if (qaOut.status !== "success") throw new Error("QA failed: " + JSON.stringify(qaOut));
  store.archiveTaskIntoProject(AGENT_ACTOR, "qa-task", PROJECT_ID);
  console.log(JSON.stringify(qaOut.result, null, 2));

  console.log("\n=== 8/8 Report Generator: final narrative ===");
  const { agentInput: reportInput } = prepareReportGeneratorInvocation({
    store, registry, credentials, catalog,
    template: { roleId: asRoleId("report-generator"), version: 1, purpose: "Report", responsibility: "Report only" },
    context: ctx("report-task", "report-generator"),
    taskDescription: "Собрать итоговое резюме для владельца агентства по результатам прогона — основа для КП клиенту.",
    materialRefs: [
      { roleId: asRoleId("research"), key: "research-task:findings" },
      { roleId: asRoleId("ceo"), key: "strategy" },
      { roleId: asRoleId("media-buyer"), key: "media-budget-plan" },
      { roleId: asRoleId("ppc"), key: "ppc-task:campaign-summary" },
      { roleId: asRoleId("copywriter"), key: "copy-task:copy-draft" },
      { roleId: asRoleId("qa"), key: "qa-verdict" },
    ],
    complexity: "routine",
    invokeTool: guardedInvoker,
  });
  const reportOut = await createReportGeneratorAgent(realReport).invoke(reportInput);
  logAgent("PM Agent", "Report Generator Agent", reportInput.task.description, reportOut.status === "success" ? { result: reportOut.result, decisions: reportOut.decisions } : reportOut);
  if (reportOut.status !== "success") throw new Error("Report failed: " + JSON.stringify(reportOut));
  console.log(JSON.stringify(reportOut.result, null, 2));

  const fullOutput = {
    projectId: PROJECT_ID,
    siteUrl: SITE_URL,
    research: researchOut.result,
    strategy: ceoOut.result,
    plan: pmOut.result,
    mediaBudget: mbOut.result,
    ppcSplit: ppcOut.result,
    copy: copyOut.result,
    qa: qaOut.result,
    report: reportOut.result,
    commLog,
  };
  writeFileSync(
    new URL("../../../mayakdent-pilot-run-output.json", import.meta.url),
    JSON.stringify(fullOutput, null, 2),
  );
  console.log("\n=== DONE. Full output + comm log written to mayakdent-pilot-run-output.json ===");
}

main().catch((err) => {
  console.error("PILOT RUN FAILED:", err);
  writeFileSync(
    new URL("../../../mayakdent-pilot-run-output.json", import.meta.url),
    JSON.stringify({ failed: true, error: String(err), commLog }, null, 2),
  );
  process.exit(1);
});
