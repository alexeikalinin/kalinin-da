import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../lib/supabase.ts";

// Read-only structure review for the weekly Knowledge Curator routine
// (~/.claude/skills/knowledge-curator.md). The routine runs in Anthropic's
// cloud sandbox, which clones this repo but has no Supabase credentials —
// and deliberately shouldn't get a copy of the service-role key just to
// read three tables. Instead it calls this endpoint, which runs where the
// credentials already live (Vercel), and returns the findings as data.
//
// Its own secret rather than the existing CRON_SECRET: that one also
// authorizes api/cron/sync-ad-stats, which writes ad_stat rows. The
// curator routine stores whatever token it uses in its trigger config, so
// it gets a token that unlocks exactly this read-only endpoint and nothing
// else. GET and strictly read-only: this endpoint reports drift, it never
// repairs it (repair is a human decision per the curator skill's own rule).
function isAuthorized(request: Request): boolean {
  const secret = process.env.STRUCTURE_REVIEW_TOKEN;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

// A sync older than this is worth flagging. Matches the curator skill's
// stated threshold; the daily sync cron (0 3 * * *) means a healthy client
// should never be more than ~1 day stale, so 10 days is a wide margin that
// only fires on something genuinely broken rather than on normal jitter.
const STALE_SYNC_DAYS = 10;

interface ClientRow {
  readonly id: string;
  readonly display_name: string;
  readonly agency_name: string | null;
  readonly agency_entity_id: string | null;
}

interface EntityRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();

  const [{ data: entities, error: entityError }, { data: clients, error: clientError }] = await Promise.all([
    supabase.from("agency_entity").select("id, name, kind").eq("tenant_id", tenantId),
    supabase.from("client").select("id, display_name, agency_name, agency_entity_id").eq("tenant_id", tenantId),
  ]);
  if (entityError) return NextResponse.json({ error: `agency_entity: ${entityError.message}` }, { status: 500 });
  if (clientError) return NextResponse.json({ error: `client: ${clientError.message}` }, { status: 500 });

  const entityById = new Map((entities ?? []).map((e: EntityRow) => [e.id, e]));

  // Two distinct problems, kept separate because they mean different
  // things: an unassigned client is invisible to every entity-scoped query
  // (silently missing), while a drifted one shows a stale/wrong entity
  // label to anyone reading agency_name instead of the FK.
  const unassignedClients: string[] = [];
  const driftedClients: Array<{ client: string; agencyNameText: string | null; actualEntity: string }> = [];
  const clientsByEntity: Record<string, string[]> = {};

  for (const client of (clients ?? []) as ClientRow[]) {
    if (!client.agency_entity_id) {
      unassignedClients.push(client.display_name);
      continue;
    }
    const entity = entityById.get(client.agency_entity_id);
    const entityName = entity?.name ?? `<unknown entity ${client.agency_entity_id}>`;
    (clientsByEntity[entityName] ??= []).push(client.display_name);
    if (client.agency_name !== entityName) {
      driftedClients.push({
        client: client.display_name,
        agencyNameText: client.agency_name,
        actualEntity: entityName,
      });
    }
  }

  // Freshest synced date per client+platform. Selecting only the columns
  // needed and ordering by date lets one pass find each pair's max without
  // pulling the full ad_stat history.
  const { data: adStat, error: adStatError } = await supabase
    .from("ad_stat")
    .select("client_id, platform, date")
    .eq("tenant_id", tenantId)
    .order("date", { ascending: false });
  if (adStatError) return NextResponse.json({ error: `ad_stat: ${adStatError.message}` }, { status: 500 });

  const clientNameById = new Map((clients ?? []).map((c: ClientRow) => [c.id, c.display_name]));
  const freshest = new Map<string, string>();
  for (const row of (adStat ?? []) as Array<{ client_id: string; platform: string; date: string }>) {
    const key = `${row.client_id}:${row.platform}`;
    if (!freshest.has(key)) freshest.set(key, row.date);
  }

  const staleThreshold = new Date(Date.now() - STALE_SYNC_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const staleSyncs: Array<{ client: string; platform: string; lastSynced: string }> = [];
  for (const [key, lastSynced] of freshest) {
    if (lastSynced >= staleThreshold) continue;
    const [clientId, platform] = key.split(":");
    staleSyncs.push({
      client: clientNameById.get(clientId) ?? `<unknown client ${clientId}>`,
      platform,
      lastSynced,
    });
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    entities: (entities ?? []).map((e: EntityRow) => ({ name: e.name, kind: e.kind })),
    clientsByEntity,
    findings: {
      unassignedClients,
      driftedClients,
      staleSyncs,
      staleSyncThresholdDays: STALE_SYNC_DAYS,
    },
    // Clients with no ad_stat rows at all are NOT reported as stale — a
    // newly onboarded client (Warface, DA.by) legitimately has no synced
    // history yet, and flagging that every week would train the reader to
    // ignore the report.
    clientsWithNoSyncedData: (clients ?? [])
      .filter((c: ClientRow) => ![...freshest.keys()].some((k) => k.startsWith(`${c.id}:`)))
      .map((c: ClientRow) => c.display_name),
  });
}
