/**
 * One-off backfill: file kit posts created before categories were assigned automatically.
 *
 * Uses the SAME rule the generator now uses — the campaign's product niche, matched
 * case-insensitively against existing categories, created if absent. Reusing the rule rather than
 * re-deciding it is the point: a backfill that files posts differently from new ones just produces
 * two conventions in one blog.
 *
 * Only ever touches posts whose `category_id` is NULL. A post someone filed by hand keeps that
 * choice — this is filling a gap, not imposing an opinion.
 *
 * Run:  npx tsx --env-file=.env.local scripts/backfill-post-categories.ts          (dry run)
 *       npx tsx --env-file=.env.local scripts/backfill-post-categories.ts --apply
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/blog";
import { categoryNameFromNiche } from "@/lib/blog/fromCampaign";

const APPLY = process.argv.includes("--apply");

async function main() {
  const db = createAdminClient();

  const { data: posts, error } = await db
    .from("blog_posts")
    .select("id, title, status, workspace_id, user_id, campaign_id")
    .is("category_id", null)
    .not("campaign_id", "is", null);
  if (error) throw error;

  // Cache per workspace so N posts in one workspace cost one read, and so two posts in the same
  // niche can't race each other into two identically-named categories.
  const cache = new Map<string, { id: string; name: string }[]>();

  let planned = 0;
  let skipped = 0;

  for (const post of (posts ?? []) as any[]) {
    const { data: campaign } = await db
      .from("campaigns")
      .select("products(niche)")
      .eq("id", post.campaign_id)
      .maybeSingle();
    const product = Array.isArray(campaign?.products) ? campaign?.products[0] : campaign?.products;
    const niche = categoryNameFromNiche(product?.niche);
    if (!niche) {
      console.log(`SKIP  "${post.title}" — its product has no niche to file it under`);
      skipped++;
      continue;
    }

    if (!cache.has(post.workspace_id)) {
      const { data } = await db
        .from("blog_categories")
        .select("id, name")
        .eq("workspace_id", post.workspace_id);
      cache.set(post.workspace_id, (data ?? []) as { id: string; name: string }[]);
    }
    const cats = cache.get(post.workspace_id)!;
    let hit = cats.find((c) => c.name.trim().toLowerCase() === niche.toLowerCase());

    if (!hit) {
      console.log(`NEW   category "${niche}"`);
      if (APPLY) {
        const { data: created, error: e } = await db
          .from("blog_categories")
          .insert({ workspace_id: post.workspace_id, user_id: post.user_id, name: niche, slug: slugify(niche) || null })
          .select("id, name")
          .single();
        if (e || !created) {
          console.log(`      ! could not create category: ${e?.message}`);
          skipped++;
          continue;
        }
        hit = created as { id: string; name: string };
        cats.push(hit);
      } else {
        // Dry run: pretend it exists so the plan below reads correctly.
        hit = { id: "(new)", name: niche };
        cats.push(hit);
      }
    }

    console.log(`FILE  [${post.status}] "${post.title}" -> ${niche}`);
    planned++;
    if (APPLY) {
      const { error: e } = await db.from("blog_posts").update({ category_id: hit.id }).eq("id", post.id);
      if (e) console.log(`      ! update failed: ${e.message}`);
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — ${planned} post(s) filed, ${skipped} skipped.`);
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
