import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../../lib/supabase.ts";
import { getCampaignChange, updateCampaignChangeStatus } from "../../../../../lib/tools/campaign-changes-store.ts";
import { runApply } from "../../../../../lib/campaign-optimization-orchestrator.ts";

// Track B's human-approval checkpoint — flips status and, on approval,
// has ppc-agent apply it immediately (the user's explicit choice: "с
// одобрения сказать агенту чтоб он выполнил их самостоятельно"). An apply
// failure still returns 207 — the approval decision itself stands; a failed
// apply needs a human to look at apply_result before retrying, never an
// automatic retry (see ppc-agent.ts's handleApply).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let change;
  try {
    change = await getCampaignChange(id);
  } catch {
    return NextResponse.json({ error: "Change not found" }, { status: 404 });
  }
  if (change.status !== "proposed") {
    return NextResponse.json({ error: `Cannot approve a change in status "${change.status}"` }, { status: 409 });
  }

  await updateCampaignChangeStatus(id, "approved", { approvedBy: "owner" });

  const { data: account, error } = await getSupabase()
    .from("client_ad_account")
    .select("platform, external_account_id")
    .eq("id", change.clientAdAccountId)
    .eq("tenant_id", getSupabaseOwnerTenantId())
    .single();
  if (error || !account) {
    return NextResponse.json({ status: "approved", applied: false, error: "client_ad_account not found" }, { status: 207 });
  }

  try {
    const result = await runApply({
      changeLogId: id,
      platform: account.platform as "google-ads" | "yandex-direct",
      externalAccountId: account.external_account_id as string,
    });
    return NextResponse.json({ status: "approved", ...result });
  } catch (applyError) {
    return NextResponse.json(
      { status: "approved", applied: false, error: applyError instanceof Error ? applyError.message : String(applyError) },
      { status: 207 },
    );
  }
}
