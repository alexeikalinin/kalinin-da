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
      const { budgetShare } = args as { budgetShare: number };
      if (!isGoogleAdsConfigured()) return "configured"; // graceful degrade, no credentials configured
      try {
        const today = new Date().toISOString().slice(0, 10);
        const result = await createOrReusePausedCampaign(`AMA Auto — ${today} — google-ads`, budgetShare);
        return result;
      } catch (error) {
        throw new ToolUnavailableError(error instanceof Error ? error.message : String(error));
      }
    }
    case "vk-ads":
      return "configured"; // not wired to a real provider yet
    case "google-analytics": {
      const { projectDisplayName, siteUrl } = args as { projectDisplayName: string; siteUrl: string };
      if (!isGoogleAnalyticsConfigured() || !isGoogleTagManagerConfigured()) return { ctr: 0.05 }; // graceful degrade
      try {
        const analytics = await provisionAnalyticsProperty(projectDisplayName, siteUrl);
        await markKeyEvent(analytics.propertyName, "generate_lead");
        await linkToGoogleAds(analytics.propertyName);
        const gtm = await provisionContainerWithGa4Tag(projectDisplayName, analytics.measurementId);
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
    default:
      throw new Error(`No real implementation wired for tool "${toolId}" yet.`);
  }
};
