import Anthropic from "@anthropic-ai/sdk";
import type { PromptBlocks } from "@ama/prompt-architecture";

// ADR-0003 — the one place the real provider-specific call format lives
// (Prompt Architecture §5: "формат итогового вызова... адаптер под
// конкретного провайдера, отдельный от логики сборки контента"). Nothing
// upstream of this file (assemblePrompt, the role packages) knows or cares
// that this is Anthropic specifically.
let client: Anthropic | undefined;

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

// Prompt Architecture §1's 7 blocks, turned into the two-part shape a real
// chat completion call actually takes — "role" is stable instruction
// (system), everything else is per-call context (user).
function renderUserMessage(prompt: PromptBlocks): string {
  const sections: string[] = [`Задача: ${prompt.task}`];
  if (prompt.clientFacts.length) sections.push(`Факты о клиенте:\n- ${prompt.clientFacts.join("\n- ")}`);
  if (prompt.domainKnowledge.length)
    sections.push(`Общие знания:\n- ${prompt.domainKnowledge.join("\n- ")}`);
  if (prompt.pastExperience.length)
    sections.push(`Прошлый опыт:\n- ${prompt.pastExperience.join("\n- ")}`);
  if (prompt.projectContext.length)
    sections.push(`Контекст проекта:\n- ${prompt.projectContext.join("\n- ")}`);
  sections.push(prompt.constraints);
  return sections.join("\n\n");
}

export interface JsonToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Anthropic.Tool.InputSchema;
}

// Forces the model to respond via a single tool call matching the given
// JSON schema — reliable structured output instead of parsing free text,
// since every role's contract needs a specific result shape (Agent
// Framework §1, "Выходные данные").
export async function callClaudeForJson<T>(
  prompt: PromptBlocks,
  modelId: string,
  tool: JsonToolSchema,
): Promise<T> {
  const response = await getClient().messages.create({
    model: modelId,
    max_tokens: 1536,
    system: prompt.role,
    messages: [{ role: "user", content: renderUserMessage(prompt) }],
    tools: [{ name: tool.name, description: tool.description, input_schema: tool.inputSchema }],
    tool_choice: { type: "tool", name: tool.name },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`Model did not call the "${tool.name}" tool as required`);
  }
  return toolUse.input as T;
}
