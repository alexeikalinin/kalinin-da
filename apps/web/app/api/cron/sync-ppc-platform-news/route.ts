import { NextResponse } from "next/server";
import { syncPpcPlatformNews } from "../../../../lib/ppc-news-orchestrator.ts";

// Vercel Cron target (see vercel.json) — fires weekly (Sunday night), but
// syncPpcPlatformNews self-gates to an actual biweekly cadence (see
// MIN_DAYS_BETWEEN_RUNS there — Vercel cron has no native >1-week
// interval). Same auth pattern as detect-trend-alerts.
function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncPpcPlatformNews();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
