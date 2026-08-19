import { cookieDomainForHost } from "@/lib/supabase/cookieOptions";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// View counting for the funnel map's per-page stats (0110_funnel_page_stats.sql), shared by the
// opt-in page (lib/publicPage.ts) and the step route so the two can't count differently.
//
// Counted once per VISITOR per page, not once per request — the same call
// increment_bridge_variant_views made and for the same reason: a refresh or a back button is not
// another visitor, and the opt-in rate shown beside these numbers (leads ÷ views) reads as
// leads-per-pageview otherwise. One cookie per campaign holds the page keys already counted,
// dot-joined ('optin' plus step uuids), same flags as the sticky A/B cookie including the
// host-aware Domain — on a tenant's BYO custom domain a Domain naming our root would make the
// browser reject the whole Set-Cookie.

const MAX_TRACKED_PAGES = 12;

function cookieName(campaignId: string): string {
  return `fs_${campaignId}`;
}

function readSeenPages(req: Request, campaignId: string): string[] {
  const raw = req.headers.get("cookie") ?? "";
  // Campaign ids are uuids ([0-9a-f-]), so interpolating one into the pattern is safe.
  const m = raw.match(new RegExp(`(?:^|;\\s*)${cookieName(campaignId)}=([^;]+)`));
  return m ? m[1].split(".").filter(Boolean) : [];
}

/**
 * Count a view of one funnel page unless this visitor was already counted for it, and return the
 * Set-Cookie that remembers them (null when nothing changed). Best-effort throughout: stats are
 * secondary to serving the page, so an RPC failure is swallowed — but the cookie is only built
 * when the increment call didn't throw, so a database hiccup undercounts rather than permanently
 * marking a visitor as counted when they weren't.
 */
export async function recordFunnelPageView(
  admin: AdminClient,
  req: Request,
  campaignId: string,
  pageKey: string
): Promise<string | null> {
  const seen = readSeenPages(req, campaignId);
  if (seen.includes(pageKey)) return null;

  try {
    await admin.rpc("increment_funnel_page_stat", {
      p_campaign_id: campaignId,
      p_page_key: pageKey,
      p_metric: "view",
    });
  } catch {
    return null;
  }

  const value = [...seen, pageKey].slice(-MAX_TRACKED_PAGES).join(".");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const d = cookieDomainForHost(req.headers.get("host"));
  const domain = d ? `; Domain=${d}` : "";
  return `${cookieName(campaignId)}=${value}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${domain}${secure}`;
}
