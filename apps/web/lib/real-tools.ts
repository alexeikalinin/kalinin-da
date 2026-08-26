import { ToolUnavailableError, type ToolInvoker } from "@ama/tools";
import { readSiteContent } from "./tools/site-reader.ts";
import { isPerplexityConfigured, searchWeb } from "./tools/web-search.ts";
import { createOrReusePausedCampaign, isGoogleAdsConfigured } from "./tools/google-ads.ts";
import {
  isGoogleAnalyticsConfigured,
  linkToGoogleAds,
  markKeyEvent,
  provisionAnalyticsProperty,
} from "./tools/google-analytics.ts";
import { isGoogleTagManagerConfigured, provisionContainerWithGa4Tag } from "./tools/google-tag-manager.ts";
import { createOrReusePausedCampaign as createOrReuseYandexCampaign, isYandexConfigured } from "./tools/yandex-direct.ts";
import { createOrReusePausedCampaign as createOrReuseMetaCampaign, isMetaAdsConfigured } from "./tools/meta-ads.ts";
import { createOrReusePausedCampaign as createOrReuseVkCampaign, isVkAdsConfigured } from "./tools/vk-ads.ts";
import { createGoal, provisionCounter } from "./tools/yandex-metrika.ts";
import { isDataLensConfigured, provisionWorkbook } from "./tools/datalens.ts";
import { generateCreativeAssets, isCreativeGenerationConfigured } from "./tools/creative-generation.ts";
import { getClientContext, isSupabaseConfigured } from "./tools/client-context.ts";
import { deployArtifact, isVercelDeployConfigured } from "./tools/vercel-deploy.ts";
import { generateDesign, isV0Configured } from "./tools/v0-design.ts";

// Real ToolInvoker (packages/tools/src/invoke.ts) for the tools that have
// a genuine implementation today — mirrors real-models.ts's one-dispatcher-
// per-concern shape. Every other toolId still has no real implementation;
// orchestrator.ts keeps those roles on their own inline fake closures until
// this dispatcher grows a case for them.
export const realToolInvoker: ToolInvoker = async (toolId, args) => {
  switch (toolId) {
    case "site-reader": {
      const { url } = args as { url: string };
      try {
        return await readSiteContent(url);
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "web-search": {
      const { query } = args as { query: string };
      if (!isPerplexityConfigured()) return "tool output"; // graceful degrade, no key configured
      try {
        return await searchWeb(query);
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "google-ads": {
      const { budgetShare, googleAdsCustomerId } = args as { budgetShare: number; googleAdsCustomerId?: string };
      if (!isGoogleAdsConfigured()) return "configured"; // graceful degrade, no credentials configured
      try {
        const today = new Date().toISOString().slice(0, 10);
        const result = await createOrReusePausedCampaign(
          `AMA Auto — ${today} — google-ads`,
          budgetShare,
          googleAdsCustomerId,
        );
        return result;
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "vk-ads": {
      const { siteUrl } = args as { siteUrl: string };
      if (!isVkAdsConfigured()) return "configured"; // graceful degrade, no credentials configured
      try {
        const today = new Date().toISOString().slice(0, 10);
        const result = await createOrReuseVkCampaign(`AMA Auto — ${today} — vk-ads`, siteUrl);
        return result;
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "meta-ads": {
      const { metaAdAccountId } = args as { metaAdAccountId?: string };
      if (!isMetaAdsConfigured()) return "configured"; // graceful degrade, no credentials configured
      try {
        const today = new Date().toISOString().slice(0, 10);
        const result = await createOrReuseMetaCampaign(`AMA Auto — ${today} — meta-ads`, metaAdAccountId);
        return result;
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "yandex-direct": {
      const { budgetShare, yandexClientLogin } = args as { budgetShare: number; yandexClientLogin?: string };
      if (!isYandexConfigured()) return "configured"; // graceful degrade, no credentials configured
      try {
        const today = new Date().toISOString().slice(0, 10);
        const result = await createOrReuseYandexCampaign(
          `AMA Auto — ${today} — yandex-direct`,
          budgetShare,
          yandexClientLogin,
        );
        return result;
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "yandex-metrika": {
      const { projectDisplayName, siteUrl } = args as { projectDisplayName: string; siteUrl: string };
      if (!isYandexConfigured()) return { ctr: 0.05 }; // graceful degrade
      try {
        const counter = await provisionCounter(projectDisplayName, siteUrl);
        await createGoal(counter.counterId, "generate_lead");
        return {
          counterId: counter.counterId,
          note: "Tracking just provisioned — no traffic/conversion data exists yet.",
        };
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "google-analytics": {
      const { projectDisplayName, siteUrl, gtmAccountId, gaAccountId, googleAdsCustomerId } = args as {
        projectDisplayName: string;
        siteUrl: string;
        gtmAccountId?: string;
        gaAccountId?: string;
        googleAdsCustomerId?: string;
      };
      if (!isGoogleAnalyticsConfigured() || !isGoogleTagManagerConfigured()) return { ctr: 0.05 }; // graceful degrade
      try {
        const analytics = await provisionAnalyticsProperty(projectDisplayName, siteUrl, gaAccountId);
        await markKeyEvent(analytics.propertyName, "generate_lead");
        await linkToGoogleAds(analytics.propertyName, googleAdsCustomerId);
        const gtm = await provisionContainerWithGa4Tag(projectDisplayName, analytics.measurementId, gtmAccountId);
        return {
          propertyName: analytics.propertyName,
          measurementId: analytics.measurementId,
          gtmContainerId: gtm.publicId,
          note: "Tracking just provisioned — no traffic/conversion data exists yet.",
        };
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "datalens": {
      const { projectDisplayName } = args as { projectDisplayName: string };
      if (!isDataLensConfigured()) return { ctr: 0.05 }; // graceful degrade
      try {
        const workbook = await provisionWorkbook(projectDisplayName);
        return {
          workbookId: workbook.workbookId,
          note: "Workbook provisioned — datasets/charts/dashboards are not built yet, this is the container only.",
        };
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "client-context": {
      const { clientId } = args as { clientId: string };
      if (!isSupabaseConfigured()) return { note: "Supabase not configured — no approved target conversions or synced ad_stat available." };
      try {
        return await getClientContext(clientId);
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "creative-generation": {
      const { briefText, channels } = args as { briefText: string; channels: readonly string[] };
      if (!isCreativeGenerationConfigured()) {
        // graceful degrade, no OPENAI_API_KEY configured
        return { assetRefs: channels.map((c) => `placeholder-asset-${c}`), note: "OPENAI_API_KEY not configured" };
      }
      try {
        return await generateCreativeAssets(briefText, channels);
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "design-tool": {
      const { brief, projectTitle, brand } = args as {
        brief?: string;
        projectTitle?: string;
        brand?: Parameters<typeof generateDesign>[0]["brand"];
      };
      if (!isV0Configured()) {
        return { note: "V0_API_KEY not configured — no mockup was generated." };
      }
      // A brief is the whole input to this tool. Generating from an empty
      // string would burn a real generation on a screen nobody asked for,
      // so this is a caller bug, reported as one.
      if (!brief?.trim()) {
        throw new ToolUnavailableError("design-tool called without a brief — nothing to design.");
      }
      try {
        return await generateDesign({
          brief,
          brand,
          projectTitle: projectTitle ?? "AMA design",
        });
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "deployment-tool": {
      const { artifact, projectName } = args as { artifact: unknown; projectName?: string };
      if (!isVercelDeployConfigured()) {
        // Named as a placeholder instead of returning a plausible-looking
        // URL: the old inline stub returned https://dev-placeholder.example,
        // which read as a real deployment in the final report.
        return { url: "about:blank", note: "VERCEL_DEPLOY_TOKEN not configured — nothing was published." };
      }
      try {
        return await deployArtifact(artifact, projectName ?? "ama-agent-deploy");
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    default:
      throw new Error(`No real implementation wired for tool "${toolId}" yet.`);
  }
};
