import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../lib/supabase.ts";

// Lists campaign_changes_log rows for the review dashboard — defaults to
// 'proposed' (the queue a human needs to act on), accepts ?status= for
// other states and ?clientAdAccountId= to scope to one account.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "proposed";
  const clientAdAccountId = url.searchParams.get("clientAdAccountId");

  let query = getSupabase()
    .from("campaign_changes_log")
    .select("id, client_ad_account_id, campaign_id, campaign_name, change_type, change_description, expected_effect, actual_effect, status, created_at, verified_at")
    .eq("tenant_id", getSupabaseOwnerTenantId())
    .eq("status", status);
  if (clientAdAccountId) query = query.eq("client_ad_account_id", clientAdAccountId);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
