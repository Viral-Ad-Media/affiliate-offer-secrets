// Twilio REST + webhook signature. SERVER-ONLY (holds credentials, uses node:crypto).
//
// Shapes probed live 2026-08-17 against api.twilio.com with a known-bad control, so they are
// measured rather than remembered:
//
//   POST /2010-04-01/Accounts/{Sid}/Messages.json   Basic auth, form-encoded To/From/Body
//   GET  /2010-04-01/Accounts/{Sid}.json            credential check
//
// The control did its job: a MALFORMED SID answers 20003 "Authentication Error - invalid
// username" while a well-formed SID with a bad token answers 20003 "Authenticate" — two distinct
// messages, so the probe was measuring the request rather than returning the same refusal to
// everything (the failure mode the Meta OAuth probes fell into).
//
// Error envelope: { code, message, more_info, status }.

import { createHmac, timingSafeEqual } from "node:crypto";

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

export class TwilioError extends Error {
  code: number | null;
  status: number;
  constructor(message: string, code: number | null, status: number) {
    super(message);
    this.name = "TwilioError";
    this.code = code;
    this.status = status;
  }
}

/** 20003 is auth; 21610 is "this number already told you STOP" and must never look transient. */
export const TWILIO_AUTH_ERROR = 20003;
export const TWILIO_OPTED_OUT = 21610;

function authHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

async function twilioFetch(
  path: string,
  accountSid: string,
  authToken: string,
  init?: { method?: string; form?: Record<string, string> }
): Promise<any> {
  const res = await fetch(`${TWILIO_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: authHeader(accountSid, authToken),
      ...(init?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init?.form ? new URLSearchParams(init.form).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TwilioError(json?.message ?? `Twilio request failed (${res.status})`, json?.code ?? null, res.status);
  }
  return json;
}

/**
 * Are these credentials real, and does the account exist?
 *
 * Run at CONNECT time so a bad token is a clear error while someone is looking at the form, rather
 * than a mystery failure on the first real send — the same rule the mail providers follow.
 */
export async function verifyTwilioCredentials(accountSid: string, authToken: string): Promise<void> {
  await twilioFetch(`/Accounts/${encodeURIComponent(accountSid)}.json`, accountSid, authToken);
}

export type SentSms = { sid: string; status: string };

export async function sendTwilioSms(args: {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
}): Promise<SentSms> {
  const json = await twilioFetch(
    `/Accounts/${encodeURIComponent(args.accountSid)}/Messages.json`,
    args.accountSid,
    args.authToken,
    { method: "POST", form: { To: args.to, From: args.from, Body: args.body } }
  );
  return { sid: json.sid, status: json.status };
}

/**
 * Verifies Twilio's `X-Twilio-Signature` on an inbound webhook.
 *
 * THIS IS THE ENTIRE TRUST BOUNDARY for the STOP handler, exactly as the Stripe signature is for
 * billing and Meta's signed_request is for deauthorize — the endpoint is public and unauthenticated,
 * and what it does is mark a contact as opted out. Forging it without this check would let anyone
 * silence a tenant's list; more importantly, a spoofed *absence* is not the risk — a spoofed STOP is.
 *
 * Twilio's algorithm, per their docs: take the full request URL, append each POST parameter's
 * name and value in alphabetical order by name with no separators, HMAC-SHA1 with the account's
 * auth token, base64.
 *
 * Compared with timingSafeEqual, which THROWS on a length mismatch — hence the length guard first.
 * Same shape lib/meta/signedRequest.ts already uses, kept here rather than shared because the two
 * algorithms are genuinely different and a shared "verify a signature" helper would invite passing
 * the wrong one.
 */
export function verifyTwilioSignature(args: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | null;
}): boolean {
  if (!args.signature) return false;
  const data =
    args.url +
    Object.keys(args.params)
      .sort()
      .map((k) => k + args.params[k])
      .join("");
  const expected = createHmac("sha1", args.authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(args.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Normalizes a typed number to E.164, or null.
 *
 * Conservative on purpose: it strips formatting and accepts an existing +country form, and it will
 * NOT guess a country for a bare 10-digit number outside the US/Canada default. Guessing wrong
 * doesn't fail loudly — it texts a stranger.
 */
export function toE164(raw: string, defaultCountryCode = "1"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) return `+${digits}`;
  return null;
}
