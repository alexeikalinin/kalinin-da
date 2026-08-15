// Tool Integration §1 — programmatic DataLens dashboards for clients,
// backed by the real Yandex Cloud DataLens Public API (api.datalens.tech).
//
// Real, hard-won finding (2026-08-15): the Public API rejects Yandex Cloud
// service-account IAM tokens outright ("Auth denied"), even after granting
// the service account explicit Admin rights on a workbook through the
// console — confirmed with both a hand-signed JWT and a `yc`-CLI-issued
// token for the same service account. Only a real *user* IAM token works.
// This mirrors what DataLens's own official MCP server does: shell out to
// `yc iam create-token` for a token tied to a real user's authenticated
// `yc` CLI session (set up once via `yc init`, refreshed automatically by
// `yc` afterwards — see apps/web/README.md for the one-time setup).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const API_BASE = "https://api.datalens.tech";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function isDataLensConfigured(): boolean {
  return Boolean(process.env.YC_BINARY_PATH && process.env.YC_PROFILE && process.env.DATALENS_ORG_ID);
}

let cachedToken: { token: string; expiresAt: number } | undefined;

async function getIamToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const ycBinary = requiredEnv("YC_BINARY_PATH");
  const profile = requiredEnv("YC_PROFILE");
  const { stdout } = await execFileAsync(ycBinary, ["iam", "create-token", "--profile", profile]);
  const token = stdout.trim();
  if (!token) throw new Error("yc iam create-token returned an empty token");
  // IAM tokens are valid 12h; refresh well before that.
  cachedToken = { token, expiresAt: Date.now() + 10 * 60 * 60 * 1000 };
  return token;
}

async function callDataLens(method: string, params: unknown): Promise<unknown> {
  const token = await getIamToken();
  const response = await fetch(`${API_BASE}/rpc/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-dl-org-id": requiredEnv("DATALENS_ORG_ID"),
      "x-dl-api-version": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const data = await response.json();
  if (!response.ok || (data as { error?: unknown }).error) {
    throw new Error(`DataLens API call failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

interface DataLensWorkbook {
  readonly workbookId: string;
  readonly title: string;
}

async function findWorkbookByTitle(title: string): Promise<DataLensWorkbook | undefined> {
  const result = (await callDataLens("getWorkbooksList", {})) as { workbooks?: DataLensWorkbook[] };
  return result.workbooks?.find((w) => w.title === title);
}

export interface ProvisionedWorkbook {
  readonly workbookId: string;
  readonly reused: boolean;
}

// Idempotent by title — a repeated call for the same project reuses its
// workbook instead of creating a duplicate. This is the container clients'
// datasets/charts/dashboards will live in; building those out (connecting
// to Metrika/Direct data, real charts) is deliberately not done here yet —
// see README's known-limitations note.
export async function provisionWorkbook(title: string): Promise<ProvisionedWorkbook> {
  const existing = await findWorkbookByTitle(title);
  if (existing) return { workbookId: existing.workbookId, reused: true };

  const created = (await callDataLens("createWorkbook", { title })) as DataLensWorkbook;
  return { workbookId: created.workbookId, reused: false };
}
