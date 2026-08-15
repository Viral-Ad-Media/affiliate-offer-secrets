/**
 * Re-bakes every funnel's stored HTML through the real render path.
 *
 * Funnel pages (campaigns.bridge_html, bridge_variants, funnel_steps.html) are rendered at WRITE
 * time — PAGE_STYLE is baked into each page — so a stylesheet or renderer change reaches a live
 * page only through a re-render. Blog pages don't need this: their shell (PUBLIC_CSS) is rendered
 * at serve time, so a deploy alone updates them.
 *
 * Uses rerenderFunnelSequence — the exact function every editor save and step change goes through —
 * never a second render path that could drift. Safe to re-run; rendering is deterministic from the
 * stored page_copy.
 *
 * Run:  npm run rerender-funnels                    (all campaigns with a bridge page)
 *       npm run rerender-funnels -- --campaign=<id> (one campaign)
 */
import { createClient } from "@supabase/supabase-js";
import { rerenderFunnelSequence } from "../lib/funnelSteps";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — run via npm script (loads .env.local)");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const only = process.argv.find((a) => a.startsWith("--campaign="))?.slice("--campaign=".length);

  let q = admin.from("campaigns").select("id, workspace_id, bridge_published").not("bridge_html", "is", null);
  if (only) q = q.eq("id", only);
  const { data: campaigns, error } = await q;
  if (error) throw error;

  let ok = 0;
  let failed = 0;
  for (const c of campaigns ?? []) {
    try {
      await rerenderFunnelSequence(admin, c.id, c.workspace_id);
      ok++;
      console.log(`ok      ${c.id}  published=${c.bridge_published}`);
    } catch (e) {
      failed++;
      console.error(`FAILED  ${c.id}  ${(e as Error).message}`);
    }
  }
  console.log(`\nre-rendered ${ok}/${(campaigns ?? []).length}, failed ${failed}`);
  if (failed > 0) process.exit(1);
}

main();
