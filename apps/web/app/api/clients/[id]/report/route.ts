import { NextResponse } from "next/server";
import { getSupabase } from "../../../../../lib/supabase.ts";
import { serializeReport } from "../../../../../lib/client-serialize.ts";

// Reads history straight out of ad_stat — the same fact table DataLens
// will connect to — rather than calling the ad platforms live. Needs
// syncAdStats to have populated data for the range first.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const url = new URL(request.url);
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate query params are required" }, { status: 400 });
  }

  const { data, error } = await getSupabase()
    .from("ad_stat")
    .select()
    .eq("client_id", clientId)
    .gte("date", startDate)
    .lte("date", endDate);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  return NextResponse.json(
    serializeReport(clientId, startDate, endDate, {
      "google-ads": rows.filter((r) => r.platform === "google-ads"),
      "yandex-direct": rows.filter((r) => r.platform === "yandex-direct"),
    }),
  );
}
