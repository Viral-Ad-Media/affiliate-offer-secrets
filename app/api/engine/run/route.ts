import { NextResponse } from "next/server";
import { runWorkerLoop } from "@/lib/engine/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by a Supabase Postgres trigger (instant, on jobs INSERT) and a pg_cron backstop
// (every ~1 minute, drives forward multi-stage jobs and reclaims anything stale). Not called
// by any client-facing code — protected by a shared secret only Supabase's trigger/cron config
// and this route know, same fail-closed shape as the Stripe webhook signature check.
export async function POST(req: Request) {
  const secret = req.headers.get("x-engine-secret");
  if (!secret || secret !== process.env.ENGINE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runWorkerLoop();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
