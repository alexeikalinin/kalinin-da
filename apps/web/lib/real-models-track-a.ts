import type { LeadFinderModelCaller } from "@ama/agent-lead-finder";
import type { AgencyResearcherModelCaller } from "@ama/agent-agency-researcher";
import type { DecisionMakerFinderModelCaller } from "@ama/agent-decision-maker-finder";
import type { LeadScorerModelCaller } from "@ama/agent-lead-scorer";
import type { OutreachCopywriterModelCaller } from "@ama/agent-outreach-copywriter";
import type { ReplyClassifierModelCaller } from "@ama/agent-reply-classifier";
import { callClaudeForJson } from "./anthropic.ts";

// Real Anthropic-backed ModelCallers for Track A (client acquisition)
// agents — mirrors real-models.ts's pattern one-for-one (grounded prompt +
// callClaudeForJson + a submit_* tool schema). Kept in a separate file
// rather than appended to real-models.ts since Track A is dispatched by
// prospecting-orchestrator.ts, not orchestrator.ts's runNode — no reason
// for the two to share a module and grow tangled imports.

export const realLeadFinder: LeadFinderModelCaller = async (prompt, modelId, searchResults) => {
  const groundedPrompt = {
    ...prompt,
    clientFacts: [...prompt.clientFacts, `Результаты веб-поиска по кандидатам:\n${searchResults.join("\n---\n")}`],
  };
  const out = await callClaudeForJson<{
    candidates: Array<{ name: string; websiteUrl: string; country?: string; employeeCountEstimate?: number }>;
    decisionSummary: string;
  }>(groundedPrompt, modelId, {
    name: "submit_candidates",
    description:
      "Submit digital marketing agencies found in the search results that plausibly fit the ICP (2-20 employees, PPC offered but not the core service). Do not invent agencies not present in the search results.",
    inputSchema: {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              websiteUrl: { type: "string" },
              country: { type: "string" },
              employeeCountEstimate: { type: "number" },
            },
            required: ["name", "websiteUrl"],
          },
        },
        decisionSummary: { type: "string" },
      },
      required: ["candidates", "decisionSummary"],
    },
  });
  return out;
};

export const realAgencyResearcher: AgencyResearcherModelCaller = async (prompt, modelId, siteContent, searchResults) => {
  const groundedPrompt = {
    ...prompt,
    clientFacts: [
      ...prompt.clientFacts,
      `Содержимое сайта агентства (реальный скрейпинг):\n${String(siteContent)}`,
      `Результаты веб-поиска:\n${String(searchResults)}`,
    ],
  };
  const out = await callClaudeForJson<{
    facts: Array<{ factKey: string; factValue: string; sourceUrl?: string; confidence?: "low" | "medium" | "high" }>;
    decisionSummary: string;
  }>(groundedPrompt, modelId, {
    name: "submit_research_facts",
    description:
      "Submit structured facts about this agency's business — services offered, whether PPC/Google Ads is a secondary service, client types, team size signal, hiring signals. Every fact must be grounded in the provided site content or search results — never invent a fact.",
    inputSchema: {
      type: "object",
      properties: {
        facts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              factKey: { type: "string" },
              factValue: { type: "string" },
              sourceUrl: { type: "string" },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["factKey", "factValue"],
          },
        },
        decisionSummary: { type: "string" },
      },
      required: ["facts", "decisionSummary"],
    },
  });
  return out;
};

export const realDecisionMakerFinder: DecisionMakerFinderModelCaller = async (prompt, modelId, siteContent, searchResults) => {
  const groundedPrompt = {
    ...prompt,
    clientFacts: [
      ...prompt.clientFacts,
      `Содержимое сайта агентства:\n${String(siteContent)}`,
      `Результаты веб-поиска о людях в компании:\n${String(searchResults)}`,
    ],
  };
  const out = await callClaudeForJson<{
    decisionMakers: Array<{
      fullName: string;
      title?: string;
      linkedinUrl?: string;
      email?: string;
      emailConfidence: "verified" | "guessed" | "unknown";
      source?: string;
    }>;
    decisionSummary: string;
  }>(groundedPrompt, modelId, {
    name: "submit_decision_makers",
    description:
      "Submit the most likely decision maker(s) (founder/owner/head of marketing/PPC director, in that priority). Only mark emailConfidence 'verified' when the email literally appears in the site content. Never invent an email — leave it unset and mark 'unknown' if not found.",
    inputSchema: {
      type: "object",
      properties: {
        decisionMakers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              fullName: { type: "string" },
              title: { type: "string" },
              linkedinUrl: { type: "string" },
              email: { type: "string" },
              emailConfidence: { type: "string", enum: ["verified", "guessed", "unknown"] },
              source: { type: "string" },
            },
            required: ["fullName", "emailConfidence"],
          },
        },
        decisionSummary: { type: "string" },
      },
      required: ["decisionMakers", "decisionSummary"],
    },
  });
  return out;
};

export const realLeadScorer: LeadScorerModelCaller = async (prompt, modelId, facts, decisionMakers) => {
  const groundedPrompt = {
    ...prompt,
    clientFacts: [
      ...prompt.clientFacts,
      `Собранные факты об агентстве:\n${JSON.stringify(facts)}`,
      `Найденные контакты:\n${JSON.stringify(decisionMakers)}`,
    ],
  };
  const out = await callClaudeForJson<{
    score: number;
    scoreBreakdown: Record<string, number>;
    decisionSummary: string;
  }>(groundedPrompt, modelId, {
    name: "submit_lead_score",
    description:
      "Score this prospect 0-100 as a white-label PPC partnership candidate, with an explainable breakdown (e.g. employeeCountFit, ppcSecondaryService, geographyFit — positive or negative numbers summing toward the total score).",
    inputSchema: {
      type: "object",
      properties: {
        score: { type: "number" },
        scoreBreakdown: { type: "object", additionalProperties: { type: "number" } },
        decisionSummary: { type: "string" },
      },
      required: ["score", "scoreBreakdown", "decisionSummary"],
    },
  });
  return out;
};

export const realOutreachCopywriter: OutreachCopywriterModelCaller = async (prompt, modelId, facts, decisionMakers) => {
  const groundedPrompt = {
    ...prompt,
    clientFacts: [
      ...prompt.clientFacts,
      `Факты об агентстве:\n${JSON.stringify(facts)}`,
      `Контакт:\n${JSON.stringify(decisionMakers)}`,
    ],
  };
  const out = await callClaudeForJson<{ subject: string; bodyText: string; decisionSummary: string }>(groundedPrompt, modelId, {
    name: "submit_outreach_draft",
    description:
      "Write a short (60-150 words), personalized cold outreach email offering white-label Google Ads/PPC fulfillment partnership. No fake compliments, no fabricated facts, no guaranteed-results claims, no aggressive sales language. Must include a low-friction, honest opt-out line (e.g. 'no worries if not' / 'let me know if you'd rather not hear more').",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        bodyText: { type: "string" },
        decisionSummary: { type: "string" },
      },
      required: ["subject", "bodyText", "decisionSummary"],
    },
  });
  return out;
};

export const realReplyClassifier: ReplyClassifierModelCaller = async (prompt, modelId, replyText) => {
  const groundedPrompt = { ...prompt, clientFacts: [...prompt.clientFacts, `Текст ответа:\n${replyText}`] };
  const out = await callClaudeForJson<{
    category: "interested" | "not_interested" | "not_relevant" | "ooo" | "unsubscribe_request" | "question" | "other";
    confidence: "low" | "medium" | "high";
    decisionSummary: string;
  }>(groundedPrompt, modelId, {
    name: "submit_reply_classification",
    description: "Classify this inbound reply to a cold outreach email.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["interested", "not_interested", "not_relevant", "ooo", "unsubscribe_request", "question", "other"],
        },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        decisionSummary: { type: "string" },
      },
      required: ["category", "confidence", "decisionSummary"],
    },
  });
  return out;
};
