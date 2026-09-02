import { NextResponse } from "next/server";
import { getDecisionMakers, getOutreachMessage, updateOutreachMessageStatus } from "../../../../../lib/tools/prospect-store.ts";
import { sendOutreachEmail } from "../../../../../lib/tools/email-provider.ts";

// Track A's human-approval checkpoint — flips status and, on approval,
// actually sends (Plan §2's "по одобрению вызывает sendOutreachEmail()").
// A send failure (e.g. domain not yet verified — see email-provider.ts's
// hard guard) still returns 207: the approval itself succeeded and should
// not be undone just because sending isn't ready yet.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let message;
  try {
    message = await getOutreachMessage(id);
  } catch {
    return NextResponse.json({ error: "Outreach message not found" }, { status: 404 });
  }
  if (message.status !== "pending_approval") {
    return NextResponse.json({ error: `Cannot approve a message in status "${message.status}"` }, { status: 409 });
  }

  await updateOutreachMessageStatus(id, "approved", { approvedBy: "owner" });

  if (!message.decisionMakerId) {
    return NextResponse.json({ status: "approved", sent: false, reason: "No decision maker on this draft." }, { status: 207 });
  }
  const decisionMakers = await getDecisionMakers(message.prospectAgencyId);
  const recipient = decisionMakers.find((dm) => dm.id === message.decisionMakerId);
  if (!recipient?.email) {
    return NextResponse.json({ status: "approved", sent: false, reason: "No recipient email on file." }, { status: 207 });
  }

  try {
    const result = await sendOutreachEmail({ to: recipient.email, subject: message.subject ?? "", bodyText: message.bodyText, outreachMessageId: id });
    return NextResponse.json({ status: "approved", ...result });
  } catch (error) {
    return NextResponse.json(
      { status: "approved", sent: false, error: error instanceof Error ? error.message : String(error) },
      { status: 207 },
    );
  }
}
