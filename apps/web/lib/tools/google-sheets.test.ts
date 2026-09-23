import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSpreadsheet, readRange, writeRange, appendRows, batchUpdateValues, isGoogleSheetsConfigured } from "./google-sheets.ts";

const REAL_FETCH = globalThis.fetch;

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

let calls: Call[];
let respond: (url: string, body: unknown) => unknown;

function installFetchMock() {
  calls = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    return new Response(JSON.stringify(respond(url, body)), { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
  process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_SHEETS_REFRESH_TOKEN = "sheets-refresh-token";
  installFetchMock();
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

test("isGoogleSheetsConfigured reflects the refresh token env var", () => {
  assert.equal(isGoogleSheetsConfigured(), true);
  delete process.env.GOOGLE_SHEETS_REFRESH_TOKEN;
  assert.equal(isGoogleSheetsConfigured(), false);
});

test("createSpreadsheet posts the title and optional sheet tabs, returns id + url", async () => {
  respond = () => ({
    spreadsheetId: "abc123",
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/abc123/edit",
  });

  const result = await createSpreadsheet("Медавеню — дубли объявлений", ["Дубли", "Заполненность"]);

  assert.equal(result.spreadsheetId, "abc123");
  assert.equal(result.spreadsheetUrl, "https://docs.google.com/spreadsheets/d/abc123/edit");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  const body = calls[0].body as { properties: { title: string }; sheets: Array<{ properties: { title: string } }> };
  assert.equal(body.properties.title, "Медавеню — дубли объявлений");
  assert.deepEqual(
    body.sheets.map((s) => s.properties.title),
    ["Дубли", "Заполненность"],
  );
});

test("readRange returns rows, defaulting to empty when the range has no values", async () => {
  respond = () => ({ values: [["a", "b"], ["c", "d"]] });
  const rows = await readRange("abc123", "Sheet1!A1:B2");
  assert.deepEqual(rows, [["a", "b"], ["c", "d"]]);

  respond = () => ({});
  const emptyRows = await readRange("abc123", "Sheet1!A1:B2");
  assert.deepEqual(emptyRows, []);
});

test("writeRange PUTs values with RAW input option to the encoded range", async () => {
  respond = () => ({});
  await writeRange("abc123", "Sheet1!A1", [["x", "y"]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.match(calls[0].url, /\/abc123\/values\/Sheet1!A1\?valueInputOption=RAW$/);
  assert.deepEqual(calls[0].body, { values: [["x", "y"]] });
});

test("appendRows POSTs to the :append endpoint with INSERT_ROWS", async () => {
  respond = () => ({});
  await appendRows("abc123", "Sheet1!A1", [["new", "row"]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /:append\?valueInputOption=RAW&insertDataOption=INSERT_ROWS$/);
  assert.deepEqual(calls[0].body, { values: [["new", "row"]] });
});

test("batchUpdateValues POSTs all ranges in a single :batchUpdate call", async () => {
  respond = () => ({});
  await batchUpdateValues("abc123", [
    { range: "Sheet1!A2:B2", values: [["a", "b"]] },
    { range: "Sheet1!A5:B5", values: [["c", "d"]] },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/abc123\/values:batchUpdate$/);
  assert.deepEqual(calls[0].body, {
    valueInputOption: "RAW",
    data: [
      { range: "Sheet1!A2:B2", values: [["a", "b"]] },
      { range: "Sheet1!A5:B5", values: [["c", "d"]] },
    ],
  });
});

test("batchUpdateValues is a no-op with an empty update list", async () => {
  respond = () => ({});
  await batchUpdateValues("abc123", []);
  assert.equal(calls.length, 0);
});
