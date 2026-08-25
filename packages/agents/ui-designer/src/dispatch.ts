import type { InvocationContext } from "@ama/agent-framework";
import type { MemoryStore } from "@ama/memory";
import type { RoleTemplate } from "@ama/prompt-architecture";
import type { CredentialStore, ToolInvoker, ToolRegistry } from "@ama/tools";
import type { ModelCatalog, TaskComplexity } from "@ama/cost-router";
import { prepareAgentInvocation } from "@ama/workflow-engine";
import type { UiDesignerTaskPayload } from "./ui-designer-agent.ts";

const MEMORY_LEVELS = ["task", "project", "client_kb"] as const;
const DESIGN_TOOL_ID = "design-tool";

export interface PrepareUiDesignerInvocationInput {
  readonly store: MemoryStore;
  readonly registry: ToolRegistry;
  readonly credentials: CredentialStore;
  readonly catalog: ModelCatalog;
  readonly template: RoleTemplate;
  readonly context: Readonly<InvocationContext>;
  readonly taskDescription: string;
  readonly clientFactKeys: readonly string[];
  // e.g. ["ux-plan"] — UX's Project Memory key (Memory System §1).
  readonly projectContextKeys: readonly string[];
  readonly complexity: TaskComplexity;
  readonly invokeTool: ToolInvoker;
  readonly deviceType?: "DESKTOP" | "MOBILE" | "TABLET" | "AGNOSTIC";
  readonly projectTitle?: string;
  // Brand direction for the design system. Omitted entirely is fine — the
  // tool falls back to its own craft standard rather than inventing a
  // brand.
  readonly brand?: UiDesignerTaskPayload["brand"];
}

// The design backend sees only this string, so everything that should
// influence the mockup has to be in it. Built from the same assembled
// prompt the model gets — the task itself, what we know about the client,
// and UX's plan — rather than from taskDescription alone, which is one
// short line ("Создать макеты.") and would produce a generic screen.
function composeDesignBrief(prompt: {
  task: string;
  clientFacts: readonly string[];
  projectContext: readonly string[];
  domainKnowledge: readonly string[];
}): string {
  const sections = [
    prompt.task,
    prompt.projectContext.length > 0 ? `UX-план и материалы проекта:\n${prompt.projectContext.join("\n")}` : "",
    prompt.clientFacts.length > 0 ? `О клиенте:\n${prompt.clientFacts.join("\n")}` : "",
    prompt.domainKnowledge.length > 0 ? `Экспертные знания:\n${prompt.domainKnowledge.join("\n")}` : "",
  ].filter(Boolean);
  return sections.join("\n\n");
}

export function prepareUiDesignerInvocation(input: PrepareUiDesignerInvocationInput) {
  return prepareAgentInvocation<UiDesignerTaskPayload>({
    store: input.store,
    registry: input.registry,
    credentials: input.credentials,
    catalog: input.catalog,
    template: input.template,
    context: input.context,
    taskDescription: input.taskDescription,
    clientFactKeys: input.clientFactKeys,
    projectContextKeys: input.projectContextKeys,
    memoryLevels: [...MEMORY_LEVELS],
    toolIds: [DESIGN_TOOL_ID],
    complexity: input.complexity,
    invokeTool: input.invokeTool,
    buildPayload: (prompt, modelId) => ({
      prompt,
      modelId,
      designToolId: DESIGN_TOOL_ID,
      designBrief: composeDesignBrief(prompt),
      deviceType: input.deviceType,
      projectTitle: input.projectTitle,
      brand: input.brand,
    }),
  });
}
