import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by pg_cron only (broadcast-sweep-backstop, every ~1 minute — see
// supabase/migrations/0021_broadcast.sql's run_broadcast_sweep() + the cron.schedule() applied
// separately via execute_sql). Not called by any client-facing code — same shared-secret,
// fail-closed shape as app/api/engine/run/route.ts, reusing the same ENGINE_WEBHOOK_SECRET.
// run_broadcast_sweep() only enrolls contacts and inserts `jobs` rows (type='send_broadcast_
// email', status='pending') — it never sends an email itself. Draining those jobs needs no extra
// call here: inserting a job with status='pending' already fires the EXISTING on_job_inserted
// trigger (0003_engine_automation.sql), which POSTs to /api/engine/run near-instantly, same as
// every other job type — this route's only job is to run the sweep, not duplicate the drain.
export async function POST(req: Request) {
  const secret = req.headers.get("x-engine-secret");
  if (!secret || secret !== process.env.ENGINE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data: sweepResult, error } = await admin.rpc("run_broadcast_sweep");
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, sweep: sweepResult });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
