import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabase, getSupabaseOwnerTenantId } from "../../../../lib/supabase.ts";
import { addToSuppressionList } from "../../../../lib/tools/prospect-store.ts";

// Resend's outbound-event webhook (delivered/bounced/complained) —
// genuinely new infrastructure (Plan §1.3): no other route in this repo
// receives a webhook. Resend signs payloads Svix-style (svix-id/
// svix-timestamp/svix-signature headers, HMAC-SHA256 of
// "<id>.<timestamp>.<body>" using the base64 portion of RESEND_WEBHOOK_SECRET
// after its "whsec_" prefix) — verified here with plain node:crypto rather
// than a Svix SDK dependency, matching this repo's "plain fetch, no SDK"
// convention for every other tools/*.ts integration.
//
// Inbound REPLY parsing (a prospect's actual reply landing here) needs
// separate MX-record routing on the sending subdomain — not assumed live
// yet (see docs/05-operations/resend-domain-warmup.md §4). This route only
// handles delivery-status events for now; the manual-log fallback for
// replies is /api/outreach/[id]/reply.

function verifySvixSignature(request: Request, rawBody: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const secretKey = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretKey).update(signedContent).digest("base64");

  // svix-signature can carry multiple space-separated "v1,<sig>" entries
  // (secret rotation) — any match is valid.
  return svixSignature.split(" ").some((entry) => {
    const [, sig] = entry.split(",");
    if (!sig) return false;
    const a = Buffer.from(sig, "base64");
    const b = Buffer.from(expected, "base64");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

interface ResendWebhookPayload {
  readonly type: string;
  readonly data: {
    readonly email_id?: string;
    readonly headers?: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySvixSignature(request, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as ResendWebhookPayload;
  const resendMessageId = payload.data.email_id;
  if (!resendMessageId) return NextResponse.json({ ok: true, note: "No email_id, ignored" });

  const statusByType: Record<string, string> = {
    "email.delivered": "sent",
    "email.bounced": "bounced",
    "email.complained": "bounced", // treated the same as a hard bounce for send-path purposes — suppression itself is added below
  };
  const newStatus = statusByType[payload.type];
  if (!newStatus) return NextResponse.json({ ok: true, note: `Event type "${payload.type}" not handled` });

  const supabase = getSupabase();
  const tenantId = getSupabaseOwnerTenantId();
  const { data: message } = await supabase
    .from("outreach_message")
    .select("id, decision_maker_id")
    .eq("resend_message_id", resendMessageId)
    .eq("tenant_id", tenantId)
    .single();

  if (!message) return NextResponse.json({ ok: true, note: "No matching outreach_message" });

  await supabase.from("outreach_message").update({ status: newStatus }).eq("id", message.id).eq("tenant_id", tenantId);

  if ((payload.type === "email.bounced" || payload.type === "email.complained") && message.decision_maker_id) {
    const { data: dm } = await supabase.from("decision_maker").select("email").eq("id", message.decision_maker_id).single();
    if (dm?.email) {
      await addToSuppressionList(dm.email, payload.type === "email.complained" ? "complaint" : "bounced_hard", "webhook:resend");
    }
  }

  return NextResponse.json({ ok: true });
}
