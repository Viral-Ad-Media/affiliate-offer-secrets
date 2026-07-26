import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDomainFullyVerified } from "@/lib/vercel/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by a pg_cron backstop every few hours (same shared-secret trust boundary as
// app/api/engine/run). A domain can be re-pointed away from Vercel after initial verification —
// not a security hole (Vercel's own edge just stops routing that hostname here), but worth
// surfacing as 'error' instead of a silent, unexplained 404 on whatever it used to serve.
export async function POST(req: Request) {
  const secret = req.headers.get("x-engine-secret");
  if (!secret || secret !== process.env.ENGINE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: domains } = await admin
    .from("custom_domains")
    .select("id, domain")
    .eq("status", "verified");

  let checked = 0;
  let flaggedError = 0;

  for (const row of domains ?? []) {
    checked++;
    const stillVerified = await isDomainFullyVerified(row.domain).catch(() => false);
    if (!stillVerified) {
      flaggedError++;
      await admin
        .from("custom_domains")
        .update({
          status: "error",
          error_message: "DNS no longer points at Vercel — re-verify after fixing your DNS records.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  return NextResponse.json({ ok: true, checked, flaggedError });
}
