import type { InvocationContext } from "./context.ts";
import type { MemoryLevel } from "./memory.ts";
import type { AgentDecision, AgentError } from "./status.ts";

export interface AgentTask<TPayload> {
  readonly context: Readonly<InvocationContext>;
  readonly payload: TPayload;
}

// Minimal read/write boundary the runtime must supply (implemented by
// @ama/memory, not by Agent Framework — see Agent Framework §1, row "Память").
export interface MemoryPort {
  read(level: MemoryLevel, key: string): Promise<unknown>;
  write(level: MemoryLevel, key: string, value: unknown): Promise<void>;
}

// Minimal tool-invocation boundary (implemented by @ama/tools via MCP —
// see Agent Framework §1, row "Используемые инструменты").
export interface ToolPort {
  invoke(toolId: string, args: unknown): Promise<unknown>;
}

export interface AgentInput<TPayload> {
  readonly task: AgentTask<TPayload>;
  readonly memory: MemoryPort;
  readonly tools: ToolPort;
}

// Agent Framework §4: every agent returns exactly one of these three shapes.
export type AgentOutput<TResult> =
  | {
      readonly status: "success";
      readonly result: TResult;
      readonly decisions: readonly AgentDecision[];
    }
  | {
      readonly status: "needs_revision";
      readonly reason: string;
      readonly partialResult?: TResult;
    }
  | {
      readonly status: "failed";
      readonly error: AgentError;
    };

export type AgentHandler<TPayload, TResult> = (
  input: AgentInput<TPayload>,
) => Promise<AgentOutput<TResult>>;

// The 11-element contract from Agent Framework §1. Only purpose,
// responsibility and completionCriteria are narrative/unique per role;
// memoryLevels and toolIds are role-specific *data* within a shared shape;
// everything else (interface, error protocol, model selection, who calls
// whom) is the common mechanism this module provides, not per-role code.
export interface AgentRoleSpec<TPayload, TResult> {
  readonly roleId: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly responsibility: string;
  readonly completionCriteria: string;
  readonly memoryLevels: readonly MemoryLevel[];
  readonly toolIds: readonly string[];
  readonly handler: AgentHandler<TPayload, TResult>;
}

export type AgentDescriptor<TPayload, TResult> = Omit<
  AgentRoleSpec<TPayload, TResult>,
  "handler"
>;

export interface Agent<TPayload, TResult> {
  readonly spec: AgentDescriptor<TPayload, TResult>;
  invoke(input: AgentInput<TPayload>): Promise<AgentOutput<TResult>>;
}

export function defineAgent<TPayload, TResult>(
  spec: AgentRoleSpec<TPayload, TResult>,
): Agent<TPayload, TResult> {
  const { handler, ...descriptor } = spec;
  return {
    spec: Object.freeze(descriptor),
    invoke: handler,
  };
}
