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
// datasets/charts/dashboards will live in.
export async function provisionWorkbook(title: string): Promise<ProvisionedWorkbook> {
  const existing = await findWorkbookByTitle(title);
  if (existing) return { workbookId: existing.workbookId, reused: true };

  const created = (await callDataLens("createWorkbook", { title })) as DataLensWorkbook;
  return { workbookId: created.workbookId, reused: false };
}

// ---------------------------------------------------------------------
// Client ad-account reporting foundation (2026-08-18) — wiring DataLens
// to the real ad_stat table in Supabase via its native PostgreSQL
// connector. Real gotchas found building this for Медавеню, all
// confirmed against the live API:
//
// 1. Supabase's *direct* connection host (db.<ref>.supabase.co:5432) has
//    only an AAAA (IPv6) record — DataLens's backend has no IPv6 egress
//    and the connection silently fails deep inside dataset creation as an
//    opaque 500. Use the Session Pooler host instead (IPv4): from the
//    Supabase dashboard's "Connect" panel, Direct tab, Session pooler
//    radio — host like `aws-1-<region>.pooler.supabase.com`, port 5432,
//    username `<role>.<project-ref>` (not just `<role>`).
// 2. Supabase's Postgres cert chains to a CA DataLens doesn't trust by
//    default ("self-signed certificate in certificate chain"). Passing
//    `ssl_ca` as a plain or base64/data-URI string via the API is
//    rejected/silently ignored ("Not a valid file data string" or no
//    effect) — the only path that worked was uploading the cert file
//    (download it from Supabase's Database Settings page,
//    "Download certificate") through the connection's edit page in the
//    DataLens UI (Продвинутые настройки подключения → CA Certificate →
//    Прикрепить файл). This step stays manual, once per connection.
// 3. Entry titles (dataset/chart/dashboard names) reject "/" — the API
//    returns a bare 400 with no field-level detail; a name like
//    "Cost / Clicks" fails while "Cost and Clicks" succeeds. Not
//    documented anywhere findable; discovered by bisecting a working vs.
//    failing title.
// 4. createDataset's "manual" table introspection can 500 on a source
//    with no raw_schema — passing an explicit raw_schema (column
//    name/title/user_type/native_type/nullable) in the same call avoids
//    the live introspection path entirely and is what actually worked.
export interface PostgresConnectionParams {
  readonly host: string;
  readonly port: number;
  readonly dbName: string;
  readonly username: string;
  readonly password: string;
}

export async function createPostgresConnection(
  title: string,
  workbookId: string,
  params: PostgresConnectionParams,
): Promise<{ readonly connectionId: string }> {
  const created = (await callDataLens("createConnection", {
    type: "postgres",
    name: title,
    workbook_id: workbookId,
    host: params.host,
    port: params.port,
    db_name: params.dbName,
    username: params.username,
    password: params.password,
  })) as { id: string };
  // ssl_enable defaults to "off" on creation; turn it on separately —
  // the CA certificate itself still has to be attached by hand (see the
  // gotcha above).
  await callDataLens("updateConnection", { connectionId: created.id, data: { ssl_enable: "on" } });
  return { connectionId: created.id };
}

export interface AdStatDatasetColumn {
  readonly name: string;
  readonly title: string;
  readonly userType: string; // DataLens UserDataType, e.g. "string" | "integer" | "float" | "date" | "uuid" | "genericdatetime" | "unsupported"
  readonly nativeType: string; // Postgres type name, e.g. "text" | "int8" | "numeric" | "date" | "uuid" | "timestamptz" | "jsonb"
  readonly nullable: boolean;
}

// The ad_stat table's columns, matching supabase/migrations/0002_client_ad_accounts.sql.
// Kept as a constant (not introspected) since createDataset's own live
// introspection path is the thing that 500s — see gotcha #4 above.
export const AD_STAT_COLUMNS: readonly AdStatDatasetColumn[] = [
  { name: "id", title: "id", userType: "uuid", nativeType: "uuid", nullable: false },
  { name: "tenant_id", title: "tenant_id", userType: "uuid", nativeType: "uuid", nullable: false },
  { name: "client_id", title: "client_id", userType: "uuid", nativeType: "uuid", nullable: false },
  { name: "platform", title: "platform", userType: "string", nativeType: "text", nullable: false },
  { name: "account_id", title: "account_id", userType: "string", nativeType: "text", nullable: false },
  { name: "date", title: "date", userType: "date", nativeType: "date", nullable: false },
  { name: "campaign_id", title: "campaign_id", userType: "string", nativeType: "text", nullable: false },
  { name: "campaign_name", title: "campaign_name", userType: "string", nativeType: "text", nullable: true },
  { name: "impressions", title: "impressions", userType: "integer", nativeType: "int8", nullable: false },
  { name: "clicks", title: "clicks", userType: "integer", nativeType: "int8", nullable: false },
  { name: "cost", title: "cost", userType: "float", nativeType: "numeric", nullable: false },
  // Real finding (2026-08-19): Google Ads (Медавеню: USD) and Yandex
  // Direct (Медавеню: BYN) report cost in their own account currency —
  // never sum/stack "cost" across platforms without checking this field
  // first; split charts by platform instead.
  { name: "currency", title: "currency", userType: "string", nativeType: "text", nullable: true },
  { name: "conversions", title: "conversions", userType: "unsupported", nativeType: "jsonb", nullable: false },
  // Plain numeric sum of the conversions jsonb's values, computed at sync
  // time (see sync-ad-stats.ts) — DataLens has no easy way to aggregate
  // an arbitrary JSON object's values itself, and different clients
  // approve different conversion sets, so this is what's actually
  // chartable.
  { name: "conversions_total", title: "conversions_total", userType: "float", nativeType: "numeric", nullable: false },
  { name: "synced_at", title: "synced_at", userType: "genericdatetime", nativeType: "timestamptz", nullable: false },
];

// The result_schema fields actually useful for charts — a subset of
// AD_STAT_COLUMNS (skips id/tenant_id/account_id/synced_at/conversions,
// which nothing charts directly today).
const CHARTABLE_COLUMNS = [
  "date",
  "platform",
  "client_id",
  "campaign_id",
  "campaign_name",
  "impressions",
  "clicks",
  "cost",
  "currency",
  "conversions_total",
];

// Calculated fields built from the raw columns above — DataLens formula
// syntax (Tableau-like, references fields by their *title* in brackets).
//
// Real finding (2026-08-19): DIV_SAFE(...) as the OUTERMOST function makes
// DataLens classify the whole field as a DIMENSION with aggregation locked
// to "None" — even though both arguments are SUM(...). That silently
// returns 0 for every point in any chart grouped by other dimensions
// (confirmed via getDataset showing "aggregation_locked": true and the
// UI's aggregation dropdown fully greyed out). Plain division classifies
// correctly as MEASURE with "Auto" aggregation. Multiply the numerator by
// a float literal (100.0, not 100) to force float division too — otherwise
// int/int truncates. See reference_datalens_gotchas.md gotcha #6.
interface CalculatedField {
  readonly guid: string;
  readonly title: string;
  readonly cast: string;
  readonly formula: string;
}

const CALCULATED_FIELDS: readonly CalculatedField[] = [
  { guid: "f_ctr", title: "CTR, %", cast: "float", formula: "SUM([clicks]) * 100.0 / SUM([impressions])" },
  { guid: "f_cr", title: "CR, %", cast: "float", formula: "SUM([conversions_total]) * 100.0 / SUM([clicks])" },
  { guid: "f_cpa", title: "CPA (cost per conversion)", cast: "float", formula: "SUM([cost]) / SUM([conversions_total])" },
];

export async function createAdStatDataset(
  title: string,
  workbookId: string,
  connectionId: string,
): Promise<{ readonly datasetId: string }> {
  const created = (await callDataLens("createDataset", {
    workbook_id: workbookId,
    name: title,
    dataset: {
      sources: [
        {
          id: "src_ad_stat",
          connection_id: connectionId,
          source_type: "PG_TABLE",
          managed_by: "user",
          title: "ad_stat",
          parameters: { table_name: "ad_stat", schema_name: "public", db_name: "postgres" },
          raw_schema: AD_STAT_COLUMNS.map((c) => ({
            name: c.name,
            title: c.title,
            user_type: c.userType,
            native_type: c.nativeType,
            nullable: c.nullable,
          })),
        },
      ],
      source_avatars: [{ id: "avatar_ad_stat", source_id: "src_ad_stat", title: "ad_stat", is_root: true, managed_by: "user" }],
      result_schema: [
        ...CHARTABLE_COLUMNS.map((name) => {
          const column = AD_STAT_COLUMNS.find((c) => c.name === name);
          if (!column) throw new Error(`Unknown ad_stat column: ${name}`);
          return {
            guid: `f_${column.name}`,
            title: column.title,
            cast: column.userType,
            calc_mode: "direct",
            avatar_id: "avatar_ad_stat",
            source: column.name,
          };
        }),
        ...CALCULATED_FIELDS.map((f) => ({
          guid: f.guid,
          title: f.title,
          cast: f.cast,
          calc_mode: "formula",
          formula: f.formula,
        })),
      ],
    },
  })) as { id: string };
  return { datasetId: created.id };
}
