import { ToolUnavailableError, type ToolInvoker } from "@ama/tools";
import { readSiteContent } from "./tools/site-reader.ts";
import { isPerplexityConfigured, searchWeb } from "./tools/web-search.ts";

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
    default:
      throw new Error(`No real implementation wired for tool "${toolId}" yet.`);
  }
};
