// Keeping Netlify's alias list in step with the custom_domains table.
//
// Netlify has no per-domain endpoint — you PATCH the site with the whole `domain_aliases` array
// (see lib/netlify/client.ts). Rather than each route appending to whatever it just fetched, every
// mutation calls this: it derives the FULL desired set from the database and pushes that.
//
// Why that shape rather than a lock: two routes adding a domain at the same instant both read the
// same table and compute the same set, so neither can drop the other's work. And anything that
// goes wrong — a dropped write, an API blip, a row added while Netlify was unreachable — is
// corrected the next time ANY domain is added, removed, or re-verified, including the 6-hourly
// reverify cron. There is no state to repair by hand.

import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileDomainAliases, isNetlifyDomainsConfigured } from "./client";

/**
 * Pushes every domain this app knows about to Netlify as the site's alias list.
 *
 * Includes PENDING domains, not just verified ones, and that is deliberate: Netlify will not issue
 * a certificate for a name that is not attached to the site, so a domain has to be an alias BEFORE
 * its DNS can be confirmed working. The app's own `status` column is what gates serving
 * (app/d/[[...path]]/route.ts requires status='verified'), not presence in this list.
 *
 * Returns the number of aliases now set, or null when Netlify isn't configured — the caller treats
 * that as "nothing to sync" rather than an error, so a deployment without domain credentials still
 * lets tenants add rows and simply doesn't attach them yet.
 */
export async function syncDomainAliases(admin: SupabaseClient): Promise<number | null> {
  if (!isNetlifyDomainsConfigured()) return null;

  // Every tenant domain, across every workspace — this is a site-level list, so it cannot be
  // scoped to the caller's workspace. Ownership was already enforced by whoever wrote the row.
  const { data, error } = await admin.from("custom_domains").select("domain");
  if (error) throw error;

  const domains = (data ?? []).map((r) => r.domain as string).filter(Boolean);
  const applied = await reconcileDomainAliases(domains);
  return applied.length;
}
