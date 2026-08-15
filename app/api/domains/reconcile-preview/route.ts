import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isDomainFullyVerified,
  isNetlifyDomainsConfigured,
  isSiteOwnName,
  previewDomainAliases,
} from "@/lib/netlify/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// What WOULD syncDomainAliases send, and would each domain verify — without writing anything.
//
// This exists because Netlify's alias list is a single site-level array shared by every tenant AND
// by our own names, so the reconciling PATCH is the one call in this integration that can break the
// live site rather than just fail. It nearly did: the first version of reconcileDomainAliases
// derived the whole list from custom_domains and would have dropped www + the subdomain wildcard.
//
// It is also the answer to a question this workflow keeps asking — "is the fixed code actually
// deployed yet?" A new route 404s on an older deploy, so a 200 here IS the proof, and it is
// read-only, so asking costs nothing. Run this before the real sweep after any change to the
// reconciler.
//
// Same x-engine-secret trust boundary as reverify-all and app/api/engine/run: no user session is
// involved, and the response describes site-level infrastructure rather than any tenant's data.
export async function POST(req: Request) {
  const secret = req.headers.get("x-engine-secret");
  if (!secret || secret !== process.env.ENGINE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("custom_domains")
    .select("domain, status")
    .order("domain");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const domains = (rows ?? []).map((r) => r.domain as string).filter(Boolean);

  if (!isNetlifyDomainsConfigured()) {
    return NextResponse.json({
      configured: false,
      note: "NETLIFY_SITE_ID / NETLIFY_AUTH_TOKEN are not both set — syncDomainAliases would no-op.",
      domains: rows ?? [],
    });
  }

  // Reads the site, computes the same set the real call would PATCH, and returns it unsent.
  const plan = await previewDomainAliases(domains);

  // Whether each domain's DNS currently reaches us. Pure reads (node:dns + a HEAD request), and
  // this is exactly what flips a row verified/error — so seeing it before the sweep runs explains
  // the outcome instead of leaving it to be inferred from a status change.
  const dns: Record<string, boolean> = {};
  for (const d of domains) dns[d] = await isDomainFullyVerified(d).catch(() => false);

  return NextResponse.json({
    configured: true,
    dbRows: rows ?? [],
    site: { primary: plan.primary, currentAliases: plan.current },
    wouldSend: plan.desired,
    preservedAsOurs: plan.current.filter(isSiteOwnName),
    wouldRemove: plan.current.filter((d) => !plan.desired.includes(d)),
    wouldAdd: plan.desired.filter((d) => !plan.current.includes(d)),
    changes: plan.changes,
    dnsVerified: dns,
  });
}
