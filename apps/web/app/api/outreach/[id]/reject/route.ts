import { NextResponse } from "next/server";
import { getOutreachMessage, updateOutreachMessageStatus } from "../../../../../lib/tools/prospect-store.ts";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await getOutreachMessage(id);
  } catch {
    return NextResponse.json({ error: "Outreach message not found" }, { status: 404 });
  }
  await updateOutreachMessageStatus(id, "rejected");
  return NextResponse.json({ status: "rejected" });
}
