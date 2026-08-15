import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDomainFullyVerified } from "@/lib/netlify/client";
import { syncDomainAliases } from "@/lib/netlify/domains";
import { notify } from "@/lib/notifications";

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
    .select("id, domain, user_id")
    .eq("status", "verified");

  // This sweep doubles as the self-healing reconcile: anything that failed to attach earlier — a
  // row added while Netlify was unreachable, a dropped PATCH — is corrected here without anyone
  // noticing it was wrong. Non-fatal, because the point of the sweep is the per-domain checks below.
  await syncDomainAliases(admin).catch((err) =>
    console.error("[domains] alias reconcile failed during reverify sweep", (err as Error).message)
  );

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
          error_message: "DNS no longer points at this app — re-verify after fixing your DNS records.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      // A domain silently falling out of verification is the definition of something the tenant
      // must act on — their funnel/blog pages stop resolving there. This sweep is the only place
      // that transition happens, so it's the only place that can raise it.
      await notify(admin, row.user_id as string, {
        kind: "domain_error",
        title: `${row.domain} stopped resolving`,
        body: "DNS no longer points at this app, so pages on this domain aren't being served. Re-verify after fixing your DNS records.",
        href: "/settings/domains",
      });
    }
  }

  return NextResponse.json({ ok: true, checked, flaggedError });
}
