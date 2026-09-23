// Google Sheets API v4 — lets agents create a spreadsheet on demand (e.g.
// to hand a client-facing table instead of an HTML preview) and read/write
// its contents. Uses a dedicated refresh token (GOOGLE_SHEETS_REFRESH_TOKEN)
// scoped to just https://www.googleapis.com/auth/spreadsheets, minted
// separately from the Ads/Analytics/GTM one via the same shared OAuth app
// (GOOGLE_ADS_CLIENT_ID/SECRET) — see google-oauth.ts's multi-credential
// convention. Sheets created this way live in the authorizing account's own
// Drive (1alexeikalinin1@gmail.com); this module has no Drive-listing
// access, only what the spreadsheets scope grants (create/read/write by ID).
import { getGoogleAccessToken } from "./google-oauth.ts";

const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const REFRESH_TOKEN_ENV = "GOOGLE_SHEETS_REFRESH_TOKEN";

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(process.env[REFRESH_TOKEN_ENV]);
}

async function callSheets(path: string, method: "GET" | "POST" | "PUT", body?: unknown): Promise<unknown> {
  const accessToken = await getGoogleAccessToken(REFRESH_TOKEN_ENV);
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google Sheets API call failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

export interface CreatedSpreadsheet {
  readonly spreadsheetId: string;
  readonly spreadsheetUrl: string;
}

// Creates a new spreadsheet, optionally with named sheets/tabs beyond the
// default "Sheet1" (pass sheetTitles to get multiple tabs in one call).
export async function createSpreadsheet(title: string, sheetTitles?: string[]): Promise<CreatedSpreadsheet> {
  const body: Record<string, unknown> = { properties: { title } };
  if (sheetTitles?.length) {
    body.sheets = sheetTitles.map((sheetTitle) => ({ properties: { title: sheetTitle } }));
  }
  const data = (await callSheets("", "POST", body)) as CreatedSpreadsheet;
  return { spreadsheetId: data.spreadsheetId, spreadsheetUrl: data.spreadsheetUrl };
}

// Reads a range (e.g. "Sheet1!A1:D50") as rows of strings — Sheets pads
// ragged rows itself for UNFORMATTED_VALUE, so no manual padding here.
export async function readRange(spreadsheetId: string, range: string): Promise<string[][]> {
  const data = (await callSheets(`/${spreadsheetId}/values/${encodeURIComponent(range)}`, "GET")) as {
    values?: string[][];
  };
  return data.values ?? [];
}

// Overwrites a range starting at the given cell with `values` — use for
// known-shape data (headers + fixed rows). RAW means Sheets stores the
// literal string/number, no formula or locale parsing.
export async function writeRange(spreadsheetId: string, range: string, values: unknown[][]): Promise<void> {
  await callSheets(`/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, "PUT", { values });
}

// Appends rows after the last row of existing data in the range's sheet —
// use for log-style writes where you don't know the next empty row number.
export async function appendRows(spreadsheetId: string, range: string, values: unknown[][]): Promise<void> {
  await callSheets(
    `/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    "POST",
    { values },
  );
}

// Writes many non-contiguous ranges in one API call instead of one
// writeRange() per row — a caller doing dozens of single-row upserts (e.g.
// the Медавеню weekly report) was hitting function timeouts from the sheer
// number of sequential round-trips (found 2026-09-21: two weeks silently
// failed to write for exactly this reason).
export async function batchUpdateValues(
  spreadsheetId: string,
  updates: readonly { readonly range: string; readonly values: unknown[][] }[],
): Promise<void> {
  if (updates.length === 0) return;
  await callSheets(`/${spreadsheetId}/values:batchUpdate`, "POST", {
    valueInputOption: "RAW",
    data: updates.map((u) => ({ range: u.range, values: u.values })),
  });
}
