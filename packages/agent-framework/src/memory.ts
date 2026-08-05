// Memory levels a role can be scoped to — Memory System §1.
// Agent Framework only declares which levels a role may touch; reading/writing
// rules themselves belong to @ama/memory.

export type MemoryLevel =
  | "session"
  | "task"
  | "project"
  | "company"
  | "domain_kb"
  | "client_kb"
  | "learning";
