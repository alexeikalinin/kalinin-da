import { NextResponse } from "next/server";
import { runMedavenueWeeklyReport } from "../../../../lib/medavenue-weekly-report.ts";

// Vercel Cron target (see vercel.json) — Monday 10:00 Minsk time (07:00
// UTC, no DST). Same auth pattern as the other cron routes (Bearer
// CRON_SECRET).
//
// Sequential per-campaign budget-verdict calls + one Sheets write per row
// caused silent truncation on 07-13.09 and a total miss on 14-20.09 (the
// run simply ran past the platform's default function timeout, with no
// error surfaced since it never got to the end-of-run verify/alert step).
export const maxDuration = 300;
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
