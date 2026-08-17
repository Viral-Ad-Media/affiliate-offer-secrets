import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTwilioSignature, toE164 } from "@/lib/twilio/client";

export const dynamic = "force-dynamic";

// Inbound SMS from Twilio — in practice, opt-outs.
//
// Public and unauthenticated by necessity: Twilio POSTs here directly. The X-Twilio-Signature HMAC
// is therefore THE ENTIRE TRUST BOUNDARY, the same role Stripe's signature plays for billing and
// Meta's signed_request plays for deauthorize. The risk it guards is not a forged absence but a
// forged PRESENCE: without it, anyone could POST "STOP" for every number they can guess and
// silently destroy a tenant's list.
//
// Verifying needs the tenant's own auth token, so the account is identified from the payload's
// AccountSid, its token is fetched from Vault, and only then is the signature checked. An unknown
// AccountSid is refused before any lookup work — and answered identically to a bad signature, so
// this can't be used to enumerate which accounts are connected here.
//
// Twilio also maintains its own STOP list and will refuse later sends with 21610. We do NOT rely
// on that: it is per-number-per-account state we can't inspect, our own sender must know, and a
// provider change would silently lose every opt-out.

/** Words carriers require to work. Matched case-insensitively on the whole trimmed body. */
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout", "opt-out"]);
const HELP_WORDS = new Set(["help", "info"]);

export async function POST(req: Request) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;

  const accountSid = params.AccountSid;
  const from = params.From;
  const body = (params.Body ?? "").trim();
  if (!accountSid || !from) return refuse();

  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("sms_connections")
    .select("workspace_id, auth_token_secret_id, from_number")
    .eq("account_sid", accountSid)
    .maybeSingle();
  if (!conn) return refuse();

  const { data: token } = await admin.rpc("get_oauth_secret", { p_secret_id: conn.auth_token_secret_id });
  if (!token) return refuse();

  // The URL Twilio signed is the one it was configured with, which is the canonical host — not
  // whatever Host header arrived. Rebuilding it from req.url would break behind any proxy or on a
  // non-canonical host, and "signature failed" is the least debuggable way for that to surface.
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/sms/inbound`;
  if (!verifyTwilioSignature({ authToken: String(token), url, params, signature: req.headers.get("x-twilio-signature") })) {
    return refuse();
  }

  const word = body.toLowerCase().replace(/[^a-z-]/g, "");
  const phone = toE164(from) ?? from;

  if (STOP_WORDS.has(word)) {
    // Every contact in this workspace holding that number — the same person can be a lead on
    // several campaigns, and honouring the opt-out for one of them is not honouring it.
    await admin
      .from("contacts")
      .update({ sms_opted_out_at: new Date().toISOString() })
      .eq("workspace_id", conn.workspace_id)
      .eq("phone", phone);
    // Twilio auto-replies to STOP itself; an empty TwiML response avoids sending a second message
    // (which would, absurdly, be a message to someone who just asked for none).
    return twiml();
  }

  if (HELP_WORDS.has(word)) {
    return twiml("You're receiving messages because you opted in. Reply STOP to opt out.");
  }

  return twiml();
}

/** One response for every rejection — unknown account, missing token, bad signature. No oracle. */
function refuse() {
  return new NextResponse("Forbidden", { status: 403 });
}

function twiml(message?: string) {
  const xml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
