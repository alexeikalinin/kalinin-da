import { NextResponse } from "next/server";
import { runMedavenueWeeklyReport } from "../../../../lib/medavenue-weekly-report.ts";

// Vercel Cron target (see vercel.json) — Monday 10:00 Minsk time (07:00
// UTC, no DST). Same auth pattern as the other cron routes (Bearer
// CRON_SECRET).
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
    const result = await runMedavenueWeeklyReport();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
