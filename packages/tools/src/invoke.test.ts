import { test } from "node:test";
import assert from "node:assert/strict";
import { invokeWithRetry, ToolUnavailableError } from "./invoke.ts";

test("a successful call returns the result directly", async () => {
  const result = await invokeWithRetry(async () => "ok", "tool", {}, undefined);
  assert.equal(result, "ok");
});

test("a transient failure is retried and can still succeed within the attempt limit", async () => {
  let calls = 0;
  const invoker = async () => {
    calls += 1;
    if (calls < 2) throw new ToolUnavailableError("timeout");
    return "recovered";
  };
  const result = await invokeWithRetry(invoker, "tool", {}, undefined);
  assert.equal(result, "recovered");
  assert.equal(calls, 2);
});

test("a transient failure that exhausts all attempts becomes a retryable AgentError (Tool Integration §4)", async () => {
  const invoker = async () => {
    throw new ToolUnavailableError("still down");
  };
  await assert.rejects(
    () => invokeWithRetry(invoker, "tool", {}, undefined, 2),
    (error: unknown) => {
      assert.equal((error as { retryable: boolean }).retryable, true);
      assert.equal((error as { code: string }).code, "TOOL_UNAVAILABLE");
      return true;
    },
  );
});

test("a non-transient failure is not retried and is reported as non-retryable", async () => {
  let calls = 0;
  const invoker = async () => {
    calls += 1;
    throw new Error("invalid credentials");
  };
  await assert.rejects(
    () => invokeWithRetry(invoker, "tool", {}, undefined, 3),
    (error: unknown) => {
      assert.equal((error as { retryable: boolean }).retryable, false);
      assert.equal((error as { code: string }).code, "TOOL_ERROR");
      return true;
    },
  );
  assert.equal(calls, 1);
});
