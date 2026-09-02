import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getWordstatFrequency, isWordstatConfigured } from "./yandex-wordstat.ts";

// 2026-08-30 — confirmed live against the real Search API the same day
// (see yandex-wordstat.ts's module comment): this mock pins down the
// exact request shape (Api-Key header, folderId in body) and response
// shape (count as a string, needs parsing) that a real call showed, so a
// future edit that drifts from either breaks a test instead of silently
// breaking keyword research.

const REAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.YANDEX_SEARCH_API_KEY = "test-api-key";
  process.env.YANDEX_SEARCH_API_FOLDER_ID = "test-folder-id";
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

test("isWordstatConfigured requires both the API key and folder id", () => {
  assert.equal(isWordstatConfigured(), true);
  delete process.env.YANDEX_SEARCH_API_FOLDER_ID;
  assert.equal(isWordstatConfigured(), false);
});

test("getWordstatFrequency sends Api-Key auth + folderId, and parses stringified counts", async () => {
  let capturedUrl = "";
  let capturedBody: unknown;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        results: [{ phrase: "грузоперевозки минск", count: "2629" }],
        associations: [{ phrase: "переезд в беларусь", count: "653" }],
        totalCount: "2629",
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const result = await getWordstatFrequency("грузоперевозки минск", ["149"], 10);

  assert.equal(capturedUrl, "https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests");
  assert.deepEqual(capturedBody, {
    phrase: "грузоперевозки минск",
    numPhrases: 10,
    regions: ["149"],
    folderId: "test-folder-id",
  });
  assert.deepEqual(result, {
    results: [{ phrase: "грузоперевозки минск", count: 2629 }],
    associations: [{ phrase: "переезд в беларусь", count: 653 }],
    totalCount: 2629,
  });
});

test("getWordstatFrequency surfaces the API's error message on a non-2xx response", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: 7, message: "Permission denied" }), { status: 403 })) as typeof fetch;

  await assert.rejects(() => getWordstatFrequency("грузоперевозки"), /Permission denied/);
});
