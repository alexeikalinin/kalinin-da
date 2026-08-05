import type { ModelTier } from "./tiers.ts";

// Cost Optimization §4 — the only place a provider-specific model name
// appears. Not described by the doc (explicitly out of Scope — "быстро
// устаревающая деталь реализации"): costs below are illustrative
// placeholders, not real pricing.
export interface ModelCatalog {
  resolve(tier: ModelTier): string;
  costPerCall(tier: ModelTier): number;
}

interface CatalogEntry {
  readonly modelId: string;
  readonly costPerCall: number;
}

export function createModelCatalog(entries: Record<ModelTier, CatalogEntry>): ModelCatalog {
  return {
    resolve: (tier) => entries[tier].modelId,
    costPerCall: (tier) => entries[tier].costPerCall,
  };
}

// ADR-0003 — Anthropic on the first iteration. Real pricing is Stage 2
// operational detail, deliberately not fixed here.
export function createAnthropicModelCatalog(): ModelCatalog {
  return createModelCatalog({
    fast: { modelId: "claude-haiku", costPerCall: 0.01 },
    base: { modelId: "claude-sonnet", costPerCall: 0.05 },
    advanced: { modelId: "claude-opus", costPerCall: 0.2 },
  });
}
