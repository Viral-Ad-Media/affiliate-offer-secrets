import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTrialConversionSweep } from "@/lib/billing/trialConversion";

export const dynamic = "force-dynamic";
// Per-user Stripe calls, so the wall clock scales with how many trials end on one day. The sweep is
// idempotent and resumable — anything not reached this tick is picked up on the next one.
export const maxDuration = 60;

/**
 * Warn about trials ending, and charge the ones that have.
 *
 * Same trust boundary as every other scheduled endpoint here: an `x-engine-secret` header checked
 * against ENGINE_WEBHOOK_SECRET, called by pg_cron through pg_net. There is no session and no user;
 * the sweep runs as service_role over every tenant.
 *
 * **This route must be in middleware.ts's PUBLIC_PREFIX_PATHS.** Missing from that list, the auth
 * gate 307s the cron to /login and nothing ever charges — the exact silent failure
 * /api/domains/reverify-all had for weeks, and the one /api/broadcast/sweep was added explicitly to
 * avoid repeating.
 *
 * Safe to call by hand at any time: it charges only trials that have already ended, respects each
 * row's `next_attempt_at`, and takes a per-user claim before talking to Stripe.
 */
export async function POST(req: Request) {
  const secret = process.env.ENGINE_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-engine-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runTrialConversionSweep(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    // A whole-sweep failure is a real operational problem (Stripe key missing, database down) and
    // should be visible as a non-2xx in net._http_response rather than a cheerful 200.
    console.error("[charge-trials] sweep failed:", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "sweep failed" }, { status: 500 });
  }
}
