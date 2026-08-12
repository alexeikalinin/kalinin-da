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

// ADR-0003 — Anthropic on the first iteration. Real, current model ids
// (2026-08-12, when apps/web was first wired to a real Anthropic key) —
// previously placeholders ("claude-haiku" etc.) since no key existed to
// call anything. Real pricing is still Stage 2 operational detail,
// deliberately not fixed here.
export function createAnthropicModelCatalog(): ModelCatalog {
  return createModelCatalog({
    fast: { modelId: "claude-haiku-4-5-20251001", costPerCall: 0.01 },
    base: { modelId: "claude-sonnet-5", costPerCall: 0.05 },
    advanced: { modelId: "claude-opus-5", costPerCall: 0.2 },
  });
}
