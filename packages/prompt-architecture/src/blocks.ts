// Prompt Architecture §1 — the 7 typed blocks. Not free-form text: each
// block has an explicit source, listed in the doc's table.
export interface PromptBlocks {
  readonly role: string; // Agent Framework role spec (purpose + responsibility)
  readonly task: string; // the current Task, from Workflow Engine/Queue
  readonly clientFacts: readonly string[]; // Knowledge Base — Client KB
  readonly domainKnowledge: readonly string[]; // Knowledge Base — Domain KB
  readonly pastExperience: readonly string[]; // Learning Memory, via Learning System
  readonly projectContext: readonly string[]; // Project Memory
  readonly constraints: string; // Execution Tier / Cost Optimization Router
}
