import type { PromptBlocks } from "@ama/prompt-architecture";
import { getSupabase } from "./supabase.ts";
import { callClaudeForJson, isAnthropicConfigured } from "./anthropic.ts";
import { isPerplexityConfigured, searchWeb } from "./tools/web-search.ts";
import { isResendConfigured, isSendingDomainVerified } from "./tools/email-provider.ts";

// Biweekly PPC-platform-news digest (2026-09-10) — keeps the PPC agent's
// working knowledge of ad-platform capabilities current between model
// training cutoffs. See supabase/migrations/0014_ppc_platform_news.sql for
// the storage shape and the cadence-gating rationale.
//
// Consumption side: apps/web/lib/real-models.ts's realPpc/realPpcRecommend
// fold the last 30 days of ppc_platform_news rows into clientFacts on
// every call — same "tool output before model call" grounding pattern as
// keyword-volume data, not a separate agent-to-agent conversation.

const PLATFORMS = ["google-ads", "yandex-direct", "vk-ads", "meta-ads"] as const;
type Platform = (typeof PLATFORMS)[number];

const PLATFORM_QUERY: Record<Platform, string> = {
  "google-ads": "Google Ads — новые функции, изменения форматов объявлений, обновления алгоритмов ставок и таргетинга за последние 2 недели. Источники: официальный блог Google Ads (blog.google/products/ads-commerce) и release notes support.google.com/google-ads.",
  "yandex-direct": "Яндекс.Директ — новые функции, изменения форматов объявлений, обновления стратегий и таргетинга за последние 2 недели. Источники: yandex.ru/support/direct и blog.yandex.ru.",
  "vk-ads": "VK Реклама (VK Ads) — новые функции, форматы объявлений, изменения кабинета за последние 2 недели. Источник: официальный блог и справка ads.vk.com.",
  "meta-ads": "Meta Ads (Facebook/Instagram Ads) — новые функции, форматы объявлений, изменения Ads Manager за последние 2 недели. Источник: Meta for Business blog (about.fb.com/news) и developers.facebook.com/docs/marketing-api/changelog.",
};

interface NewsItem {
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly sourceUrl?: string;
}

async function findPlatformNews(platform: Platform): Promise<readonly NewsItem[]> {
  const rawFindings = await searchWeb(PLATFORM_QUERY[platform]);

  const prompt: PromptBlocks = {
    role:
      "Ты — аналитик, который вычленяет конкретные, проверяемые изменения в рекламных платформах из сырого " +
      "поискового ответа. Игнорируй общие маркетинговые статьи и мнения — только фактические изменения продукта.",
    task: `Из текста ниже вычлени список реальных изменений/новинок платформы ${platform} за последние 2 недели.`,
    clientFacts: [`Сырой результат поиска:\n${rawFindings}`],
    domainKnowledge: [],
    pastExperience: [],
    projectContext: [],
    constraints:
      "Если в тексте нет конкретных, датированных изменений продукта (а только общие статьи/мнения/старые " +
      "новости) — верни пустой массив items. Не выдумывай изменения, которых нет в тексте.",
  };

  const out = await callClaudeForJson<{ items: NewsItem[] }>(prompt, "claude-sonnet-5", {
    name: "submit_platform_news",
    description: "Submit the list of concrete, dated product changes found in the search findings.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short, specific title, e.g. 'RSA заменены на комбинаторные объявления'." },
              summary: { type: "string", description: "2-4 предложения: что изменилось и что это значит для PPC-специалиста." },
              category: {
                type: "string",
                enum: ["new_ad_format", "bidding_change", "deprecation", "targeting_change", "policy_change", "other"],
              },
              sourceUrl: { type: "string" },
            },
            required: ["title", "summary", "category"],
          },
        },
      },
      required: ["items"],
    },
  });

  return out.items;
}

export interface SyncPpcPlatformNewsResult {
  readonly ran: true;
  readonly itemsFound: number;
  readonly digestText: string;
  readonly emailSent: boolean;
}

export interface SyncPpcPlatformNewsSkipped {
  readonly ran: false;
  readonly reason: string;
}

// Vercel cron has no native "every 2 weeks" schedule — this fires weekly
// (see apps/web/vercel.json) and self-gates here against the last recorded
// run. A skipped week leaves the gate untouched, so cadence self-corrects
// even if a run fails outright (next week's check just re-evaluates against
// the same last-success timestamp).
const MIN_DAYS_BETWEEN_RUNS = 12;

export async function syncPpcPlatformNews(): Promise<SyncPpcPlatformNewsResult | SyncPpcPlatformNewsSkipped> {
  const supabase = getSupabase();

  const { data: lastRun } = await supabase
    .from("ppc_platform_news_sync_run")
    .select("run_at")
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastRun) {
    const daysSince = (Date.now() - new Date(lastRun.run_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < MIN_DAYS_BETWEEN_RUNS) {
      return { ran: false, reason: `last run was ${daysSince.toFixed(1)} days ago, gate is ${MIN_DAYS_BETWEEN_RUNS} days` };
    }
  }

  if (!isAnthropicConfigured() || !isPerplexityConfigured()) {
    return { ran: false, reason: "ANTHROPIC_API_KEY or PERPLEXITY_API_KEY not set" };
  }

  const perPlatform = await Promise.all(
    PLATFORMS.map(async (platform) => {
      try {
        const items = await findPlatformNews(platform);
        return { platform, items, error: undefined as string | undefined };
      } catch (err) {
        return { platform, items: [] as readonly NewsItem[], error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const allNewRows = perPlatform.flatMap(({ platform, items }) =>
    items.map((item) => ({
      platform,
      title: item.title,
      summary: item.summary,
      category: item.category,
      source_url: item.sourceUrl ?? null,
    })),
  );

  if (allNewRows.length > 0) {
    const { error: insertError } = await supabase
      .from("ppc_platform_news")
      .upsert(allNewRows, { onConflict: "platform,title", ignoreDuplicates: true });
    if (insertError) throw new Error(`Failed to store ppc_platform_news: ${insertError.message}`);
  }

  await supabase.from("ppc_platform_news_sync_run").insert({ items_found: allNewRows.length });

  const digestText = renderDigest(perPlatform);
  const emailSent = await sendDigestEmail(digestText);

  return { ran: true, itemsFound: allNewRows.length, digestText, emailSent };
}

function renderDigest(
  perPlatform: readonly { platform: Platform; items: readonly NewsItem[]; error?: string }[],
): string {
  const lines = [`Сводка новостей рекламных платформ — ${new Date().toISOString().slice(0, 10)}`, ""];
  for (const { platform, items, error } of perPlatform) {
    lines.push(`## ${platform}`);
    if (error) {
      lines.push(`(не удалось получить: ${error})`);
    } else if (items.length === 0) {
      lines.push("Существенных изменений за последние 2 недели не найдено.");
    } else {
      for (const item of items) {
        lines.push(`- **${item.title}** [${item.category}]: ${item.summary}${item.sourceUrl ? ` (${item.sourceUrl})` : ""}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

// Internal notification, deliberately separate from
// tools/email-provider.ts's sendOutreachEmail — that path is coupled to
// the outreach suppression list, daily send cap, and an outreach_message_id
// FK, none of which apply to a single internal digest to the agency owner.
async function sendDigestEmail(digestText: string): Promise<boolean> {
  if (!isResendConfigured() || !isSendingDomainVerified()) return false;

  const to = process.env.PPC_NEWS_DIGEST_TO;
  if (!to) return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM_ADDRESS,
      to,
      subject: "PPC platform news — biweekly digest",
      text: digestText,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}
