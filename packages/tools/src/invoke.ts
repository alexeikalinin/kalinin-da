import type { AgentError } from "@ama/agent-framework";

export type ToolInvoker = (
  toolId: string,
  args: unknown,
  credential: unknown,
) => Promise<unknown>;

// Tool Integration §4 — throw this from a real invoker to signal "this is
// probably transient, worth retrying" (e.g. a timeout). Any other thrown
// error is treated as non-retryable (bad credentials, invalid input) — the
// distinction the doc draws between "retry is enough" and "critical, Task
// fails."
export class ToolUnavailableError extends Error {}

// Placeholder attempt count — same calibration status as every other
// threshold deferred across this codebase.
const DEFAULT_MAX_ATTEMPTS = 2;

export async function invokeWithRetry(
  invoke: ToolInvoker,
  toolId: string,
  args: unknown,
  credential: unknown,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await invoke(toolId, args, credential);
    } catch (error) {
      lastError = error;
      if (!(error instanceof ToolUnavailableError)) break; // non-retryable, stop immediately
    }
  }
  throw toAgentError(toolId, lastError);
}

function toAgentError(toolId: string, error: unknown): AgentError {
  const retryable = error instanceof ToolUnavailableError;
  return {
    code: retryable ? "TOOL_UNAVAILABLE" : "TOOL_ERROR",
    message: error instanceof Error ? error.message : `Tool "${toolId}" failed`,
    retryable,
  };
}
