import { NextResponse } from "next/server";
import { getCampaignChange, updateCampaignChangeStatus } from "../../../../../lib/tools/campaign-changes-store.ts";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await getCampaignChange(id);
  } catch {
    return NextResponse.json({ error: "Change not found" }, { status: 404 });
  }
  await updateCampaignChangeStatus(id, "rejected");
  return NextResponse.json({ status: "rejected" });
}
