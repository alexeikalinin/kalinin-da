import { asRoleId, type RoleId } from "@ama/agent-framework";
import type { CeoModelCaller } from "@ama/agent-ceo";
import type { PmModelCaller, RoleSelection } from "@ama/agent-pm";
import type { ResearchModelCaller } from "@ama/agent-research";
import type { SeoModelCaller } from "@ama/agent-seo";
import type { PpcModelCaller } from "@ama/agent-ppc";
import type { MediaBuyerModelCaller } from "@ama/agent-media-buyer";
import type { UxModelCaller } from "@ama/agent-ux";
import type { UiDesignerModelCaller } from "@ama/agent-ui-designer";
import type { CopywriterModelCaller } from "@ama/agent-copywriter";
import type { FrontendModelCaller } from "@ama/agent-frontend";
import type { AnalyticsModelCaller } from "@ama/agent-analytics";
import type { QaModelCaller } from "@ama/agent-qa";
import type { ReportModelCaller } from "@ama/agent-report-generator";
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
  const out = await callClaudeForJson<{ strategySummary: string; priorityGoals: string[]; decisionSummary: string }>(
    prompt,
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
  void input; // already embedded in the assembled prompt's task description
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

export const realSeo: SeoModelCaller = async (prompt, modelId) => {
  const out = await callClaudeForJson<{ targetKeywords: string[]; recommendations: string[]; decisionSummary: string }>(
    prompt,
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

export const realPpc: PpcModelCaller = async (prompt, modelId) => {
  const out = await callClaudeForJson<{ budgetSplit: Record<string, number>; decisionSummary: string }>(
    prompt,
    modelId,
    {
      name: "submit_campaign_plan",
      description: "Submit how the ad budget is split across channels (shares summing to ~1).",
      inputSchema: {
        type: "object",
        properties: { budgetSplit: CHANNEL_SPLIT_SCHEMA, decisionSummary: { type: "string" } },
        required: ["budgetSplit", "decisionSummary"],
      },
    },
  );
  return { result: { budgetSplit: out.budgetSplit }, decisionSummary: out.decisionSummary };
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
  const out = await callClaudeForJson<{ mockupRefs: string[]; designNotes: string; decisionSummary: string }>(
    prompt,
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
  void toolOutput;
  return {
    design: { mockupRefs: out.mockupRefs, designNotes: out.designNotes },
    decisionSummary: out.decisionSummary,
  };
};

export const realCopywriter: CopywriterModelCaller = async (prompt, modelId, briefs) => {
  const out = await callClaudeForJson<{ texts: string[]; decisionSummary: string }>(prompt, modelId, {
    name: "submit_copy",
    description: "Submit the written texts for the given briefs.",
    inputSchema: {
      type: "object",
      properties: { texts: { type: "array", items: { type: "string" } }, decisionSummary: { type: "string" } },
      required: ["texts", "decisionSummary"],
    },
  });
  void briefs;
  return { draft: { texts: out.texts }, decisionSummary: out.decisionSummary };
};

export const realFrontend: FrontendModelCaller = async (prompt, modelId, materials) => {
  const out = await callClaudeForJson<{ html: string; decisionSummary: string }>(prompt, modelId, {
    name: "submit_build",
    description: "Submit the assembled page markup to deploy.",
    inputSchema: {
      type: "object",
      properties: { html: { type: "string" }, decisionSummary: { type: "string" } },
      required: ["html", "decisionSummary"],
    },
  });
  void materials;
  return { buildArtifact: { html: out.html }, decisionSummary: out.decisionSummary };
};

export const realAnalytics: AnalyticsModelCaller = async (prompt, modelId, rawMetrics) => {
  const out = await callClaudeForJson<{ summary: string; metrics: Record<string, number>; decisionSummary: string }>(
    prompt,
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
  void rawMetrics;
  return { report: { summary: out.summary, metrics: out.metrics }, decisionSummary: out.decisionSummary };
};

export const realQa: QaModelCaller = async (prompt, modelId, artifact, checklistId) => {
  const out = await callClaudeForJson<{ approved: boolean; issues: string[]; decisionSummary: string }>(
    prompt,
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
  void artifact;
  void checklistId;
  return { verdict: { approved: out.approved, issues: out.issues }, decisionSummary: out.decisionSummary };
};

export const realReport: ReportModelCaller = async (prompt, modelId, materials) => {
  const out = await callClaudeForJson<{ narrativeSummary: string; decisionSummary: string }>(prompt, modelId, {
    name: "submit_final_report",
    description: "Submit the narrative summary of the completed Project.",
    inputSchema: {
      type: "object",
      properties: { narrativeSummary: { type: "string" }, decisionSummary: { type: "string" } },
      required: ["narrativeSummary", "decisionSummary"],
    },
  });
  void materials;
  return { narrativeSummary: out.narrativeSummary, decisionSummary: out.decisionSummary };
};
