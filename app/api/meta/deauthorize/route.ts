import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFbClientSecret } from "@/lib/meta/config";

export const dynamic = "force-dynamic";

// Called directly by Meta (registered as this app's "Deauthorize Callback URL") when a user
// revokes the app's access from their own Facebook settings — the only proactive signal we get
// for that event; token expiry alone won't catch it. Verifies Meta's signed_request (HMAC-SHA256
// over the app secret) before touching the DB, same fail-closed shape as the Stripe webhook.
function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export async function POST(req: Request) {
  // formData() THROWS on a non-form body, which on a public unauthenticated endpoint surfaced as
  // an unhandled 500 rather than a clean rejection. Meta always posts form-encoded, so this never
  // affected real traffic — found while probing the route during the webhook-host fix.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected form-encoded body" }, { status: 400 });
  }
  const signedRequest = form.get("signed_request");
  if (typeof signedRequest !== "string") {
    return NextResponse.json({ error: "missing signed_request" }, { status: 400 });
  }

  const [encodedSig, encodedPayload] = signedRequest.split(".");
  if (!encodedSig || !encodedPayload) {
    return NextResponse.json({ error: "malformed signed_request" }, { status: 400 });
  }

  const expectedSig = crypto.createHmac("sha256", getFbClientSecret()).update(encodedPayload).digest();
  const actualSig = base64UrlDecode(encodedSig);
  if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  const fbUserId = payload.user_id;
  if (!fbUserId) return NextResponse.json({ error: "missing user_id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("meta_connections")
    .select("id, workspace_id")
    .eq("fb_user_id", fbUserId)
    .maybeSingle();

  if (connection) {
    await admin
      .from("meta_connections")
      .update({ status: "needs_reconnect", updated_at: new Date().toISOString() })
      .eq("id", connection.id);
    await admin.from("meta_pages").update({ status: "needs_reconnect" }).eq("workspace_id", connection.workspace_id);
  }

  return NextResponse.json({ ok: true });
}
