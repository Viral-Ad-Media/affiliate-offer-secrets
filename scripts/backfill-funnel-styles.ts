/**
 * Re-renders existing funnel pages so they pick up the current stylesheet.
 *
 * WHY THIS EXISTS, and why the blog needed nothing: a funnel page's HTML is baked at write time —
 * `servePublicCampaignPage` hands back `campaigns.bridge_html` byte for byte — so a change to
 * PAGE_STYLE reaches a page only when something re-renders it. Blog posts are the opposite: their
 * stylesheet is injected at SERVE time by `renderPublicPostHtml`, and `blog_posts.html` is only
 * the body fragment, so posts already show the new design on their next request. Checked before
 * writing this, which is why it touches funnels only.
 *
 * CONTENT IS NOT REGENERATED. Every page is re-rendered from its own stored `page_copy` tree
 * through `rerenderFunnelSequence` — the same function the editor calls after a save. No Anthropic
 * call, no credits, no new copy. What changes is the markup and the <style> block around content
 * that already existed, including hand-edited copy.
 *
 * `rerenderFunnelSequence` also covers the split-test variants and every funnel step, and re-bakes
 * the hoplinks and tracking snippets as it goes, which is exactly why it is used rather than a
 * hand-rolled loop over bridge_html: those hrefs are baked in too, and re-rendering them any other
 * way is how a page ends up pointing at the wrong offer.
 *
 * Dry by default. Nothing is written without --apply, because this rewrites pages that are live
 * and taking paid traffic.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-funnel-styles.ts            # report only
 *   npx tsx --env-file=.env.local scripts/backfill-funnel-styles.ts --apply    # actually write
 *   npx tsx --env-file=.env.local scripts/backfill-funnel-styles.ts --apply --campaign <uuid>
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";

const APPLY = process.argv.includes("--apply");
const ONLY = (() => {
  const i = process.argv.indexOf("--campaign");
  return i >= 0 ? process.argv[i + 1] : null;
})();

async function main() {
  const admin = createAdminClient();

  let query = admin
    .from("campaigns")
    .select("id, workspace_id, name, bridge_published, page_copy, products(product_title)")
    .not("bridge_html", "is", null);
  if (ONLY) query = query.eq("id", ONLY);

  const { data: campaigns, error } = await query;
  if (error) {
    console.error("Could not read campaigns:", error.message);
    process.exit(1);
  }

  const rows = campaigns ?? [];
  // A campaign with no stored tree cannot be re-rendered from one, and re-deriving its copy is a
  // different (and destructive) operation — those are left exactly as they are.
  const renderable = rows.filter((c) => c.page_copy != null);
  const skipped = rows.filter((c) => c.page_copy == null);

  console.log(`${rows.length} funnel page(s) with stored HTML`);
  console.log(`  ${renderable.length} re-renderable (have page_copy)`);
  console.log(`  ${renderable.filter((c) => c.bridge_published).length} of those are PUBLISHED and taking traffic`);
  if (skipped.length) {
    console.log(`  ${skipped.length} skipped — no page_copy, nothing to re-render from:`);
    for (const c of skipped) console.log(`      ${c.id}  ${title(c)}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Nothing written. Re-run with --apply to write.");
    return;
  }

  let ok = 0;
  const failed: { id: string; message: string }[] = [];
  for (const c of renderable) {
    try {
      await rerenderFunnelSequence(admin, c.id as string, c.workspace_id as string);
      ok++;
      console.log(`  re-rendered  ${c.id}  ${title(c)}`);
    } catch (e) {
      // Keep going. One campaign with an odd tree must not stop the rest from being updated, and
      // a page that failed simply keeps the HTML it already had — which still works.
      const message = e instanceof Error ? e.message : String(e);
      failed.push({ id: c.id as string, message });
      console.log(`  FAILED       ${c.id}  ${title(c)} — ${message}`);
    }
  }

  console.log(`\n${ok} re-rendered, ${failed.length} failed, ${skipped.length} skipped.`);
  if (failed.length) process.exitCode = 1;
}

function title(c: Record<string, unknown>): string {
  const product = (c.products as { product_title?: string } | null)?.product_title;
  return product ?? (c.name as string | null) ?? "(untitled)";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
