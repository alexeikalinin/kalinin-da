import { createHash } from "node:crypto";

// Tool Integration §1 — Creative Agent's own tool ("Используемые
// инструменты"). Provider-abstracted on purpose (Architecture Overview §5's
// same principle applied to a generative tool, not just the LLM): the
// contract is "generate creative assets," not "call OpenAI" — a real video
// provider (Veo 3.1 / Kling 3) can be added later behind the same toolId
// without touching @ama/agent-creative.
//
// gpt-image-1 is scheduled for retirement 2026-10-23 (confirmed against
// OpenAI's own /v1/models listing 2026-08-18) — default to gpt-image-1.5,
// override via OPENAI_IMAGE_MODEL if needed.
const DEFAULT_IMAGE_MODEL = "gpt-image-1.5";
const IMAGE_GENERATION_TIMEOUT_MS = 60_000;

export function isCreativeGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export interface CreativeAssetResult {
  readonly assetRefs: readonly string[];
  readonly note: string;
}

interface OpenAiImageResponse {
  readonly data?: ReadonlyArray<{ readonly b64_json?: string; readonly url?: string }>;
}

// One image per requested channel, since ad formats/sizes differ by
// placement (mirrors PpcTaskPayload's per-channel loop). Returns a stable
// content-hash ref, not the raw image bytes — persisting the actual file to
// blob storage is Backlog (same "proves the real call, not the full
// pipeline" status as datalens.ts's provisionWorkbook); keeping a full
// base64 payload in the in-process MemoryStore singleton would also risk
// unbounded memory growth here (no such cap exists on that store).
export async function generateCreativeAssets(
  briefText: string,
  channels: readonly string[],
): Promise<CreativeAssetResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

  const assetRefs: string[] = [];
  for (const channel of channels) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: `${briefText}\n\nРекламный креатив для площадки: ${channel}.`,
        size: "1024x1024",
        n: 1,
      }),
      signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OpenAI image generation failed for "${channel}": ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as OpenAiImageResponse;
    const image = data.data?.[0];
    const content = image?.b64_json ?? image?.url;
    if (!content) {
      throw new Error(`OpenAI image generation returned no image for "${channel}"`);
    }
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    assetRefs.push(`openai:${model}:${channel}:${hash}`);
  }

  return {
    assetRefs,
    note: "Байты изображений не сохраняются в blob storage (Backlog) — ref подтверждает реальный вызов генерации, не хранит сам файл.",
  };
}
