import crypto from "crypto";
import { getFbClientSecret } from "@/lib/meta/config";

/**
 * Meta's `signed_request` — the only thing authenticating its two server-to-server callbacks
 * (Deauthorize and Data Deletion Request). Both are unauthenticated public endpoints, so this
 * HMAC IS the trust boundary, exactly as the Stripe webhook's signature is for that route.
 *
 * Extracted rather than copied into the second callback: two hand-maintained implementations of
 * one signature check is how one of them ends up subtly weaker (a `===` instead of a
 * timing-safe compare, a missing length guard) with nothing to notice it.
 */

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export type SignedRequestResult =
  | { ok: true; payload: Record<string, unknown>; fbUserId: string }
  | { ok: false; error: string; status: 400 | 401 };

/**
 * Reads and verifies the `signed_request` field of a form-encoded Meta callback body.
 *
 * Fails closed on every branch, and returns the HTTP status the caller should answer with so the
 * two routes can't disagree about what a malformed body versus a bad signature means.
 */
export async function readSignedRequest(req: Request): Promise<SignedRequestResult> {
  // formData() THROWS on a non-form body, which on a public endpoint surfaces as an unhandled
  // 500 rather than a clean rejection. Meta always posts form-encoded; this is for everyone else
  // who finds the URL.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, error: "expected form-encoded body", status: 400 };
  }

  const signedRequest = form.get("signed_request");
  if (typeof signedRequest !== "string") {
    return { ok: false, error: "missing signed_request", status: 400 };
  }

  const [encodedSig, encodedPayload] = signedRequest.split(".");
  if (!encodedSig || !encodedPayload) {
    return { ok: false, error: "malformed signed_request", status: 400 };
  }

  const expectedSig = crypto.createHmac("sha256", getFbClientSecret()).update(encodedPayload).digest();
  const actualSig = base64UrlDecode(encodedSig);
  // Length check first: timingSafeEqual THROWS on a length mismatch rather than returning false.
  if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
    return { ok: false, error: "invalid signature", status: 401 };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    return { ok: false, error: "malformed payload", status: 400 };
  }

  const fbUserId = payload.user_id;
  if (typeof fbUserId !== "string" || !fbUserId) {
    return { ok: false, error: "missing user_id", status: 400 };
  }

  return { ok: true, payload, fbUserId };
}
