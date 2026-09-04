import { asRoleId, type RoleId } from "@ama/agent-framework";
import type { CeoModelCaller } from "@ama/agent-ceo";
import type { PmModelCaller, RoleSelection } from "@ama/agent-pm";
import type { ResearchModelCaller } from "@ama/agent-research";
import type { SeoModelCaller } from "@ama/agent-seo";
import type { PpcSetupModelCaller, PpcRecommendModelCaller } from "@ama/agent-ppc";
import type { MediaBuyerModelCaller } from "@ama/agent-media-buyer";
import type { CreativeModelCaller } from "@ama/agent-creative";
import type { UxModelCaller } from "@ama/agent-ux";
import type { UiDesignerModelCaller } from "@ama/agent-ui-designer";
import type { CopywriterModelCaller } from "@ama/agent-copywriter";
import type { FrontendModelCaller } from "@ama/agent-frontend";
import type { AnalyticsModelCaller } from "@ama/agent-analytics";
import type { QaModelCaller } from "@ama/agent-qa";
import type { ReportModelCaller } from "@ama/agent-report-generator";
import type { AgentArchitectModelCaller } from "@ama/agent-agent-architect";
import { callClaudeForJson } from "./anthropic.ts";

// Real Anthropic-backed implementations of every role's ModelCaller —
// mirrors lib/orchestrator.ts's fake* callers one-for-one, so swapping is
// a matter of which set gets wired in (see orchestrator.ts's
// resolveModelCallers), not a different call shape.

const CHANNEL_SPLIT_SCHEMA = {
  type: "object" as const,
  additionalProperties: { type: "number" as const },
};

export const realCeo: CeoModelCaller = async (prompt, modelId, input) => {
  // Was `void input` — the comment claimed this was "already embedded in
  // the assembled prompt's task description", which is false: CEO's own
  // dispatch.ts (@ama/agent-ceo) hardcodes clientFactKeys to [], and the
  // taskDescription callers pass is a fixed generic string ("Определить
  // стратегию для Project."), never siteUrl/businessDescription/product/
  // marketingTask. Without this, the model had no way to see what the
  // actual client or task was — see 2026-08-27 belseltur.com pilot run.
  const groundedPrompt = {
    ...prompt,
    clientFacts: [
      ...prompt.clientFacts,
      `Сайт клиента: ${input.siteUrl}`,
      `Описание бизнеса: ${input.businessDescription}`,
      `Продукт/услуга: ${input.product}`,
      `Маркетинговая задача: ${input.marketingTask}`,
    ],
  };
  const out = await callClaudeForJson<{ strategySummary: string; priorityGoals: string[]; decisionSummary: string }>(
    groundedPrompt,
    modelId,
    {
      name: "submit_strategy",
      description: "Submit the strategic direction for this Project.",
      inputSchema: {
        type: "object",
        properties: {
          strategySummary: { type: "string" },
          priorityGoals: { type: "array", items: { type: "string" } },
          decisionSummary: { type: "string", description: "One sentence, in Russian, explaining the decision." },
        },
        required: ["strategySummary", "priorityGoals", "decisionSummary"],
      },
    },
  );
  return {
    strategy: { strategySummary: out.strategySummary, priorityGoals: out.priorityGoals },
    decisionSummary: out.decisionSummary,
  };
};

export function realPm(availableRoleIds: readonly RoleId[]): PmModelCaller {
  return async (prompt, modelId) => {
    const out = await callClaudeForJson<{ selections: RoleSelection[]; decisionSummary: string }>(
      prompt,
      modelId,
      {
        name: "submit_plan",
        description: "Submit the Task graph: which roles are needed, in what order.",
        inputSchema: {
          type: "object",
          properties: {
            selections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  taskId: { type: "string" },
                  roleId: { type: "string", enum: availableRoleIds as unknown as string[] },
                  dependsOn: { type: "array", items: { type: "string" } },
                },
                required: ["taskId", "roleId", "dependsOn"],
              },
            },
            decisionSummary: { type: "string" },
          },
          required: ["selections", "decisionSummary"],
        },
      },
    );
    return {
      selections: out.selections.map((s) => ({ ...s, roleId: asRoleId(s.roleId) })),
      decisionSummary: out.decisionSummary,
    };
  };
}

export const realResearch: ResearchModelCaller = async (prompt, modelId, siteContent, searchResults) => {
  // site-reader/web-search now return real text (real-tools.ts) — fold it
  // into clientFacts so the model actually sees it, instead of the tool
  // output being fetched and then discarded.
  const groundedPrompt = {
    ...prompt,
    clientFacts: [
      ...prompt.clientFacts,
      `Содержимое сайта клиента (реальный скрейпинг):\n${String(siteContent)}`,
      `Результаты веб-поиска по рынку/конкурентам:\n${String(searchResults)}`,
    ],
  };
  const out = await callClaudeForJson<{ summary: string; facts: string[]; decisionSummary: string }>(
    groundedPrompt,
    modelId,
    {
      name: "submit_findings",
      description: "Submit structured research findings about the client's site and market.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          facts: { type: "array", items: { type: "string" } },
          decisionSummary: { type: "string" },
        },
        required: ["summary", "facts", "decisionSummary"],
      },
    },
  );
  return { findings: { summary: out.summary, facts: out.facts }, decisionSummary: out.decisionSummary };
};

export const realSeo: SeoModelCaller = async (prompt, modelId, keywordData) => {
  // Was `(prompt, modelId)` — the third param (seo-service's real keyword
  // data, real-tools.ts) was declared on SeoModelCaller but never actually
  // read, same "tool output fetched then discarded" bug realResearch was
  // fixed for on 2026-08-27 (see project_agent_framework_maturity memory) —
  // this role just hadn't been touched by that pass since it wasn't
  // exercised against a real project yet.
  const groundedPrompt = {
    ...prompt,
    clientFacts: [...prompt.clientFacts, `Реальные данные по ключевым словам сайта (объём поиска, конкуренция, ставки):\n${JSON.stringify(keywordData)}`],
  };
  const out = await callClaudeForJson<{ targetKeywords: string[]; recommendations: string[]; decisionSummary: string }>(
    groundedPrompt,
    modelId,
    {
      name: "submit_seo_recommendations",
      description: "Submit SEO keyword targets and recommendations.",
      inputSchema: {
        type: "object",
        properties: {
          targetKeywords: { type: "array", items: { type: "string" } },
          recommendations: { type: "array", items: { type: "string" } },
          decisionSummary: { type: "string" },
        },
        required: ["targetKeywords", "recommendations", "decisionSummary"],
      },
    },
  );
  return {
    recommendations: { targetKeywords: out.targetKeywords, recommendations: out.recommendations },
    decisionSummary: out.decisionSummary,
  };
};

// 2026-08-30 — keywords/adCopy added: budgetSplit alone gave PPC's real
// google-ads tool call nothing to build beyond an empty paused campaign
// shell (see google-ads.ts's buildPausedSearchCampaign). Per-channel, both
// optional in the schema since only google-ads's real tool call currently
// acts on them — other channels can omit them.
const CHANNEL_KEYWORDS_SCHEMA = {
  type: "object" as const,
  additionalProperties: { type: "array" as const, items: { type: "string" as const } },
};
const CHANNEL_AD_COPY_SCHEMA = {
  type: "object" as const,
  additionalProperties: {
    type: "object" as const,
    properties: {
      headlines: { type: "array" as const, items: { type: "string" as const } },
      descriptions: { type: "array" as const, items: { type: "string" as const } },
    },
    required: ["headlines", "descriptions"],
  },
};
// negativeKeywords/callouts share keywords' shape; sitelinks is its own
// per-channel array-of-objects shape. 2026-08-30 — geoTargetConstants/
// languageConstants are deliberately NOT asked of the model: those need
// real Google resource-name ids (e.g. "geoTargetConstants/1011969" for
// Moscow) resolved via GeoTargetConstantService.suggestGeoTargetConstants,
// which isn't wired anywhere in this codebase — asking the model would
// just produce plausible-looking but almost certainly wrong ids that fail
// at the Ads API, the same "void a real param" shape of bug found and
// fixed elsewhere in this file, just inverted (garbage in, not blank in).
const CHANNEL_SITELINKS_SCHEMA = {
  type: "object" as const,
  additionalProperties: {
    type: "array" as const,
    items: {
      type: "object" as const,
      properties: { text: { type: "string" as const }, finalUrl: { type: "string" as const } },
      required: ["text", "finalUrl"],
    },
  },
};

export const realPpc: PpcSetupModelCaller = async (prompt, modelId) => {
  const out = await callClaudeForJson<{
    budgetSplit: Record<string, number>;
    keywords?: Record<string, string[]>;
    adCopy?: Record<string, { headlines: string[]; descriptions: string[] }>;
    negativeKeywords?: Record<string, string[]>;
    sitelinks?: Record<string, { text: string; finalUrl: string }[]>;
    callouts?: Record<string, string[]>;
    decisionSummary: string;
  }>(prompt, modelId, {
    name: "submit_campaign_plan",
    description:
      "Submit how the ad budget is split across channels (shares summing to ~1). " +
      "For google-ads specifically, also submit: the search keywords to target; " +
      "Responsive Search Ad copy (at least 3 headlines ≤30 chars each, at least 2 " +
      "descriptions ≤90 chars each — Google Ads rejects an ad outside those bounds); " +
      "negative keywords to exclude irrelevant traffic; optional sitelinks (link text " +
      "≤25 chars) and callouts (≤25 chars) to strengthen the ad.",
    inputSchema: {
      type: "object",
      properties: {
        budgetSplit: CHANNEL_SPLIT_SCHEMA,
        keywords: CHANNEL_KEYWORDS_SCHEMA,
        adCopy: CHANNEL_AD_COPY_SCHEMA,
        negativeKeywords: CHANNEL_KEYWORDS_SCHEMA,
        sitelinks: CHANNEL_SITELINKS_SCHEMA,
        callouts: CHANNEL_KEYWORDS_SCHEMA,
        decisionSummary: { type: "string" },
      },
      required: ["budgetSplit", "decisionSummary"],
    },
  });
  return {
    result: {
      budgetSplit: out.budgetSplit,
      keywords: out.keywords,
      adCopy: out.adCopy,
      negativeKeywords: out.negativeKeywords,
      sitelinks: out.sitelinks,
      callouts: out.callouts,
    },
    decisionSummary: out.decisionSummary,
  };
};

// Track B (campaign optimization, 2026-08-30) — generalizes
// .claude/agents/medavenue-analyst.md's verdict classification into a real
// caller. campaignData already carries live campaign list/report + prior
// changes (folded in by ppc-agent's handleRecommend before this is
// called) — same "tool output before model call" grounding as realResearch.
export const realPpcRecommend: PpcRecommendModelCaller = async (prompt, modelId, campaignData) => {
  const groundedPrompt = {
    ...prompt,
    clientFacts: [...prompt.clientFacts, `Данные по кампаниям (реальные, за последний период):\n${JSON.stringify(campaignData)}`],
  };
  const out = await callClaudeForJson<{
    proposedChanges: Array<{
      campaignId?: string;
      campaignName?: string;
      changeType: string;
      changeDescription: string;
      expectedEffect?: string;
      verdict?: "scale" | "optimize" | "cut" | "pause" | "watch";
    }>;
    decisionSummary: string;
  }>(groundedPrompt, modelId, {
    name: "submit_recommendations",
    description:
      "Submit proposed optimization changes for these live campaigns, based only on the real campaign data provided — never invent a campaign or metric. changeType must be one of: budget_changed, weekly_spend_limit_changed, negative_added, bid_adjusted, status_changed. changeDescription must include the concrete parameters needed to apply the change as 'key: value' lines (e.g. for budget_changed: 'campaignBudgetResourceName: ...' and 'newAmountMicros: 5000000'; for negative_added: 'campaignResourceName: ...' and 'keywords: a, b, c'). Classify each campaign with a verdict: scale (increase investment), optimize (tighten targeting/bids), cut (reduce spend), pause (stop entirely), or watch (no action yet, insufficient data).",
    inputSchema: {
      type: "object",
      properties: {
        proposedChanges: {
          type: "array",
          items: {
            type: "object",
            properties: {
              campaignId: { type: "string" },
              campaignName: { type: "string" },
              changeType: {
                type: "string",
                enum: ["budget_changed", "weekly_spend_limit_changed", "negative_added", "bid_adjusted", "status_changed"],
              },
              changeDescription: { type: "string" },
              expectedEffect: { type: "string" },
              verdict: { type: "string", enum: ["scale", "optimize", "cut", "pause", "watch"] },
            },
            required: ["changeType", "changeDescription"],
          },
        },
        decisionSummary: { type: "string" },
      },
      required: ["proposedChanges", "decisionSummary"],
    },
  });
  return out;
};

export const realMediaBuyer: MediaBuyerModelCaller = async (prompt, modelId) => {
  const out = await callClaudeForJson<{
    totalBudget: number;
    allocation: Record<string, number>;
    decisionSummary: string;
  }>(prompt, modelId, {
    name: "submit_media_plan",
    description: "Submit the overall media budget and its channel allocation.",
    inputSchema: {
      type: "object",
      properties: {
        totalBudget: { type: "number" },
        allocation: CHANNEL_SPLIT_SCHEMA,
        decisionSummary: { type: "string" },
      },
      required: ["totalBudget", "allocation", "decisionSummary"],
    },
  });
  return {
    plan: { totalBudget: out.totalBudget, allocation: out.allocation },
    decisionSummary: out.decisionSummary,
  };
};

export const realCreative: CreativeModelCaller = async (prompt, modelId, toolOutput) => {
  const out = await callClaudeForJson<{ notes: string; decisionSummary: string }>(prompt, modelId, {
    name: "submit_creative_notes",
    description: "Submit the rationale for the generated ad creative assets.",
    inputSchema: {
      type: "object",
      properties: {
        notes: { type: "string" },
        decisionSummary: { type: "string" },
      },
      required: ["notes", "decisionSummary"],
    },
  });
  // assetRefs come from the real creative-generation tool call, not the
  // model — the model explains/refines the result (Agent Framework §3's
  // "tool before model" pattern), it does not invent the refs itself, since
  // that would silently discard the real generation call's actual output.
  const toolAssetRefs =
    toolOutput && typeof toolOutput === "object" && Array.isArray((toolOutput as { assetRefs?: unknown }).assetRefs)
      ? ((toolOutput as { assetRefs: string[] }).assetRefs)
      : [];
  return {
    assets: { assetRefs: toolAssetRefs, notes: out.notes },
    decisionSummary: out.decisionSummary,
  };
};

export const realUx: UxModelCaller = async (prompt, modelId) => {
  const out = await callClaudeForJson<{ userFlows: string[]; structureNotes: string; decisionSummary: string }>(
    prompt,
    modelId,
    {
      name: "submit_ux_plan",
      description: "Submit user flows and structure notes.",
      inputSchema: {
        type: "object",
        properties: {
          userFlows: { type: "array", items: { type: "string" } },
          structureNotes: { type: "string" },
          decisionSummary: { type: "string" },
        },
        required: ["userFlows", "structureNotes", "decisionSummary"],
      },
    },
  );
  return {
    plan: { userFlows: out.userFlows, structureNotes: out.structureNotes },
    decisionSummary: out.decisionSummary,
  };
};

export const realUiDesigner: UiDesignerModelCaller = async (prompt, modelId, toolOutput) => {
  // Was `void toolOutput` — same pattern as Copywriter/QA/Report Generator
  // (2026-08-27 pilot run): the real design-tool call's actual result never
  // reached the model, so designNotes described a mockup the model never saw.
  const groundedPrompt = {
    ...prompt,
    clientFacts: [...prompt.clientFacts, `Результат вызова design-tool:\n${JSON.stringify(toolOutput, null, 2)}`],
  };
  const out = await callClaudeForJson<{ mockupRefs: string[]; designNotes: string; decisionSummary: string }>(
    groundedPrompt,
    modelId,
    {
      name: "submit_design",
      description: "Submit mockup references and design rationale.",
      inputSchema: {
        type: "object",
        properties: {
          mockupRefs: { type: "array", items: { type: "string" } },
          designNotes: { type: "string" },
          decisionSummary: { type: "string" },
        },
        required: ["mockupRefs", "designNotes", "decisionSummary"],
      },
    },
  );
  return {
    design: { mockupRefs: out.mockupRefs, designNotes: out.designNotes },
    decisionSummary: out.decisionSummary,
  };
};

export const realCopywriter: CopywriterModelCaller = async (prompt, modelId, briefs) => {
  // Was `void briefs` — the one argument carrying the actual brief content
  // (research findings, strategy) was silently discarded, so the model
  // wrote from the generic taskDescription alone and produced copy with no
  // connection to the real client (see 2026-08-27 belseltur.com pilot run,
  // where this produced generic sales copy with zero mention of the
  // client's actual business).
  const groundedPrompt = {
    ...prompt,
    clientFacts: [...prompt.clientFacts, ...briefs.map((b, i) => `Бриф ${i + 1}:\n${b}`)],
  };
  const out = await callClaudeForJson<{ texts: string[]; decisionSummary: string }>(groundedPrompt, modelId, {
    name: "submit_copy",
    description: "Submit the written texts for the given briefs.",
    inputSchema: {
      type: "object",
      properties: { texts: { type: "array", items: { type: "string" } }, decisionSummary: { type: "string" } },
      required: ["texts", "decisionSummary"],
    },
  });
  return { draft: { texts: out.texts }, decisionSummary: out.decisionSummary };
};

export const realFrontend: FrontendModelCaller = async (prompt, modelId, materials) => {
  // Was `void materials` — same pattern as Copywriter/QA/Report Generator
  // (2026-08-27 pilot run): the page got built from nothing, not from what
  // the other roles actually produced.
  const groundedPrompt = {
    ...prompt,
    clientFacts: [...prompt.clientFacts, `Материалы для сборки страницы:\n${JSON.stringify(materials, null, 2)}`],
  };
  const out = await callClaudeForJson<{ html: string; decisionSummary: string }>(groundedPrompt, modelId, {
    name: "submit_build",
    description: "Submit the assembled page markup to deploy.",
    inputSchema: {
      type: "object",
      properties: { html: { type: "string" }, decisionSummary: { type: "string" } },
      required: ["html", "decisionSummary"],
    },
  });
  return { buildArtifact: { html: out.html }, decisionSummary: out.decisionSummary };
};

export const realAnalytics: AnalyticsModelCaller = async (prompt, modelId, rawMetrics) => {
  // Was previously `void rawMetrics` — every real GA/Metrika/DataLens (and
  // now client-context) tool call was fetched and then silently discarded,
  // never reaching the model. Fold it into clientFacts the same way
  // realResearch does with siteContent/searchResults, so the model can
  // actually check approved target_conversion / synced ad_stat against
  // what GA/Metrika/DataLens report, not just narrate from the task prompt.
  const groundedPrompt = {
    ...prompt,
    clientFacts: [
      ...prompt.clientFacts,
      `Сырые данные из аналитических инструментов и client-context (реальный вызов API):\n${JSON.stringify(rawMetrics, null, 2)}`,
    ],
  };
  const out = await callClaudeForJson<{ summary: string; metrics: Record<string, number>; decisionSummary: string }>(
    groundedPrompt,
    modelId,
    {
      name: "submit_report",
      description: "Submit a summary and key metrics for campaign performance.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          metrics: CHANNEL_SPLIT_SCHEMA,
          decisionSummary: { type: "string" },
        },
        required: ["summary", "metrics", "decisionSummary"],
      },
    },
  );
  return { report: { summary: out.summary, metrics: out.metrics }, decisionSummary: out.decisionSummary };
};

export const realQa: QaModelCaller = async (prompt, modelId, artifact, checklistId) => {
  // Was `void artifact; void checklistId` — QA never actually saw the
  // thing it was reviewing, only the generic taskDescription. Its verdict
  // ("materials not provided") was technically honest given what it
  // received, but useless as review: it was rejecting an empty prompt, not
  // checking the real artifact (see 2026-08-27 belseltur.com pilot run).
  const groundedPrompt = {
    ...prompt,
    clientFacts: [
      ...prompt.clientFacts,
      `Чек-лист: ${checklistId}`,
      `Артефакт для проверки:\n${JSON.stringify(artifact, null, 2)}`,
    ],
  };
  const out = await callClaudeForJson<{ approved: boolean; issues: string[]; decisionSummary: string }>(
    groundedPrompt,
    modelId,
    {
      name: "submit_verdict",
      description: "Submit the QA verdict for the reviewed artifact.",
      inputSchema: {
        type: "object",
        properties: {
          approved: { type: "boolean" },
          issues: { type: "array", items: { type: "string" } },
          decisionSummary: { type: "string" },
        },
        required: ["approved", "issues", "decisionSummary"],
      },
    },
  );
  return { verdict: { approved: out.approved, issues: out.issues }, decisionSummary: out.decisionSummary };
};

export const realReport: ReportModelCaller = async (prompt, modelId, materials) => {
  // Was `void materials` — report-generator-agent.ts already does the real
  // work of reading each upstream Task's actual output from Project Memory
  // into `materials`; discarding it here meant the model fabricated a
  // plausible-sounding but content-free narrative instead of summarizing
  // what was actually produced, with no error to signal it (see
  // 2026-08-27 belseltur.com pilot run).
  const groundedPrompt = {
    ...prompt,
    clientFacts: [
      ...prompt.clientFacts,
      `Материалы, собранные от участвовавших ролей:\n${JSON.stringify(materials, null, 2)}`,
    ],
  };
  const out = await callClaudeForJson<{ narrativeSummary: string; decisionSummary: string }>(groundedPrompt, modelId, {
    name: "submit_final_report",
    description: "Submit the narrative summary of the completed Project.",
    inputSchema: {
      type: "object",
      properties: { narrativeSummary: { type: "string" }, decisionSummary: { type: "string" } },
      required: ["narrativeSummary", "decisionSummary"],
    },
  });
  return { narrativeSummary: out.narrativeSummary, decisionSummary: out.decisionSummary };
};

// Agent Framework §4a — a service role, not a conveyor role, so it has no
// fake* counterpart in orchestrator.ts's runNode switch: it is never a
// graph node. Reached through its own endpoint instead
// (app/api/agent-architect/propose), the same way Reflection is reached
// from finalize rather than from the graph.
export const realAgentArchitect: AgentArchitectModelCaller = async (
  prompt,
  modelId,
  roleDescription,
  existingRoleIds,
) => {
  // Was `void roleDescription; void existingRoleIds;` (below, after the
  // call) — same pattern found across every other role in the 2026-08-27
  // pilot run: the model never saw what role was actually being requested,
  // nor the existing roles it's supposed to check for overlap against.
  const groundedPrompt = {
    ...prompt,
    clientFacts: [
      ...prompt.clientFacts,
      `Описание запрашиваемой роли:\n${roleDescription}`,
      `Существующие роли (проверить на пересечение):\n${existingRoleIds.join(", ")}`,
    ],
  };
  const out = await callClaudeForJson<{
    roleId: string;
    displayName: string;
    purpose: string;
    responsibility: string;
    completionCriteria: string;
    memoryLevels: string[];
    toolIds: string[];
    overlapWarnings: string[];
    decisionSummary: string;
  }>(groundedPrompt, modelId, {
    name: "submit_role_spec_proposal",
    description:
      "Propose a new agent role spec by the standard contract. Flag any overlap with existing roles rather than assuming the boundary is clean.",
    inputSchema: {
      type: "object",
      properties: {
        roleId: { type: "string" },
        displayName: { type: "string" },
        purpose: { type: "string" },
        responsibility: { type: "string" },
        completionCriteria: { type: "string" },
        memoryLevels: { type: "array", items: { type: "string" } },
        toolIds: { type: "array", items: { type: "string" } },
        overlapWarnings: { type: "array", items: { type: "string" } },
        decisionSummary: { type: "string" },
      },
      required: [
        "roleId",
        "displayName",
        "purpose",
        "responsibility",
        "completionCriteria",
        "memoryLevels",
        "toolIds",
        "overlapWarnings",
        "decisionSummary",
      ],
    },
  });
  return {
    proposal: {
      roleId: asRoleId(out.roleId),
      displayName: out.displayName,
      purpose: out.purpose,
      responsibility: out.responsibility,
      completionCriteria: out.completionCriteria,
      memoryLevels: out.memoryLevels as never,
      toolIds: out.toolIds,
      overlapWarnings: out.overlapWarnings,
    },
    decisionSummary: out.decisionSummary,
  };
};
