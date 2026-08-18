import { NextResponse } from "next/server";
import { syncAdStats } from "../../../../../lib/sync-ad-stats.ts";

// Manual trigger only — no cron/scheduled wrapper yet (explicitly deferred
// in the plan). Body identifies which client_ad_account to pull, not the
// client itself, since one client can have several (Google + Yandex).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await params; // clientId kept for route symmetry; syncAdStats resolves it from adAccountId
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.adAccountId !== "string" || typeof body.startDate !== "string" || typeof body.endDate !== "string") {
    return NextResponse.json({ error: "adAccountId, startDate, endDate are required strings" }, { status: 400 });
  }

  try {
    const result = await syncAdStats(body.adAccountId, { startDate: body.startDate, endDate: body.endDate });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
