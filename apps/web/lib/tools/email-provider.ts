import { countOutreachMessagesSentToday, isSuppressed, updateOutreachMessageStatus } from "./prospect-store.ts";

// Track A's outreach send path (Plan §1.3) — real Resend integration, but
// the user does not yet have a verified sending domain. The guard below is
// the load-bearing part of this file: it refuses to send anything until
// EMAIL_FROM_ADDRESS is a real, verified address, rather than silently
// degrading (the pattern every other tools/*.ts file in this repo uses for
// "not configured yet") — a bounce/spam-complaint storm from a placeholder
// domain would poison the reputation of whatever real domain gets verified
// later once someone forgets the guard is missing. See
// docs/05-operations/resend-domain-warmup.md for the manual verification +
// ramp steps this depends on.
const RESEND_API_BASE = "https://api.resend.com";
const SEND_TIMEOUT_MS = 15_000;
const PLACEHOLDER_FROM_ADDRESS = "outreach@placeholder.invalid";
const DEFAULT_DAILY_SEND_CAP = 20;

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function isSendingDomainVerified(): boolean {
  const from = process.env.EMAIL_FROM_ADDRESS;
  return Boolean(from && from !== PLACEHOLDER_FROM_ADDRESS);
}

export class EmailDomainNotVerifiedError extends Error {
  constructor() {
    super(
      "EMAIL_FROM_ADDRESS is not set (or still the placeholder) — refusing to send real outreach email from an " +
        "unverified domain. Verify a sending subdomain in Resend and set EMAIL_FROM_ADDRESS once ramp-up is " +
        "ready; see docs/05-operations/resend-domain-warmup.md.",
    );
    this.name = "EmailDomainNotVerifiedError";
  }
}

export class DailySendCapReachedError extends Error {
  constructor(cap: number) {
    super(`Daily outreach send cap (${cap}) already reached for today — see DAILY_SEND_CAP.`);
    this.name = "DailySendCapReachedError";
  }
}

export interface SendOutreachEmailArgs {
  readonly to: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly bodyHtml?: string;
  readonly replyTo?: string;
  // Correlates a Resend send back to its outreach_message row — both for
  // the daily-cap count and so a later inbound-reply webhook can match a
  // reply thread back to what was sent.
  readonly outreachMessageId: string;
}

export type SendOutreachEmailResult =
  | { readonly sent: true; readonly resendMessageId: string }
  // Not an error: the recipient is on the suppression list, so the correct
  // behavior is "quietly don't send", same as every other tools/*.ts
  // "graceful degrade" convention in this repo — just for a different
  // reason (compliance, not missing config).
  | { readonly sent: false; readonly reason: "suppressed" };

export async function sendOutreachEmail(args: SendOutreachEmailArgs): Promise<SendOutreachEmailResult> {
  if (!isResendConfigured()) throw new Error("RESEND_API_KEY is not set");
  if (!isSendingDomainVerified()) throw new EmailDomainNotVerifiedError();

  if (await isSuppressed(args.to)) {
    await updateOutreachMessageStatus(args.outreachMessageId, "suppressed");
    return { sent: false, reason: "suppressed" };
  }

  const cap = Number(process.env.DAILY_SEND_CAP ?? DEFAULT_DAILY_SEND_CAP);
  const sentToday = await countOutreachMessagesSentToday();
  if (sentToday >= cap) throw new DailySendCapReachedError(cap);

  const from = process.env.EMAIL_FROM_ADDRESS as string;
  const response = await fetch(`${RESEND_API_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: args.to,
      subject: args.subject,
      text: args.bodyText,
      html: args.bodyHtml,
      reply_to: args.replyTo,
      // Cheap correlation for the inbound webhook (Plan §1.3) — Resend
      // echoes custom headers back on delivery events, avoiding a second
      // lookup table just to map resend_message_id -> outreach_message_id
      // (the column already stores that once the send succeeds below).
      headers: { "X-AMA-Outreach-Message-Id": args.outreachMessageId },
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  const data = (await response.json()) as { id?: string; message?: string };
  if (!response.ok || !data.id) {
    throw new Error(`Resend send failed: ${response.status} ${data.message ?? JSON.stringify(data)}`);
  }

  await updateOutreachMessageStatus(args.outreachMessageId, "sent", { resendMessageId: data.id });
  return { sent: true, resendMessageId: data.id };
}
