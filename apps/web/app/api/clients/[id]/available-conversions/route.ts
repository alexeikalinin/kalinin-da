import { NextResponse } from "next/server";
import { resolveAccessContext } from "../../../../../lib/tools/platform-identity.ts";
import { listConversionActions } from "../../../../../lib/tools/google-ads.ts";
import { listGoals } from "../../../../../lib/tools/yandex-metrika.ts";

// Read-only "what's available to approve" list (conversion-audit skill,
// step 1-2). Google Ads is resolved through a client_ad_account row
// (?adAccountId=...); Yandex Metrika counters aren't modeled in
// client_ad_account (that table only covers google-ads/yandex-direct), so
// the counter id + credential are passed straight through
// (?counterId=...&credentialRef=...) until a dedicated entity exists.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await params; // clientId not needed here yet — kept for route symmetry
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform");

  if (platform === "google-ads") {
    const adAccountId = url.searchParams.get("adAccountId");
    if (!adAccountId) {
      return NextResponse.json({ error: "adAccountId is required for platform=google-ads" }, { status: 400 });
    }
    const access = await resolveAccessContext(adAccountId);
    const actions = await listConversionActions(access.externalAccountId, {
      refreshTokenEnv: access.credentialRef,
      loginCustomerId: access.managerId ?? undefined,
    });
    return NextResponse.json(actions);
  }

  if (platform === "yandex-metrika") {
    const counterId = url.searchParams.get("counterId");
    if (!counterId) {
      return NextResponse.json({ error: "counterId is required for platform=yandex-metrika" }, { status: 400 });
    }
    const credentialRef = url.searchParams.get("credentialRef") ?? undefined;
    const goals = await listGoals(Number(counterId), credentialRef);
    return NextResponse.json(goals);
  }

  return NextResponse.json({ error: "platform must be 'google-ads' or 'yandex-metrika'" }, { status: 400 });
}
