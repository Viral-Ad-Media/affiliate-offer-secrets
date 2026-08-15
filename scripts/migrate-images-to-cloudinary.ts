/**
 * Moves existing inline base64 images onto Cloudinary.
 *
 * Everything written from now on is hosted at the point of writing (the routes and engine jobs each
 * call uploadImageRef/uploadTreeImages). This is the other half: the rows that already exist, which
 * are all of the ones actually being served today. Measured before writing it — a blog index at
 * 4,136,287 bytes, a post at 1,232,113, campaigns.bridge_html averaging 105 kB — all of it one
 * image repeated.
 *
 * Ordered by id everywhere, so --limit picks the SAME rows on every run. Without it PostgREST has
 * no implicit ordering and a careful one-row first pass silently tests a different row each time.
 *
 * IDEMPOTENT. Every value is skipped unless it starts with `data:`, so a re-run after a partial
 * pass costs nothing and picks up only what is left. Safe to interrupt.
 *
 * RE-RENDERS after rewriting, which is the part that is easy to get wrong. bridge_html,
 * funnel_steps.html and blog_posts.html are baked at write time in this codebase — rewriting the
 * column alone would leave the SERVED page still carrying the base64 while page_copy claimed
 * otherwise. Funnel pages go back through rerenderFunnelSequence (the same function every other
 * mutation uses) rather than a second render path written here.
 *
 * DELIBERATELY NOT INCLUDED: profiles.avatar_url. It is app-internal — never rendered into a public
 * page, so it carries no visitor bandwidth — and update_profile() (0040:66) rejects anything that
 * is not a data: URI, so a hosted value would be refused the next time someone saved their profile.
 * Migrating it would mean widening a deliberate security check for no measured gain.
 *
 * Run:  npx tsx --env-file=.env.local scripts/migrate-images-to-cloudinary.ts            (dry run)
 *       npx tsx --env-file=.env.local scripts/migrate-images-to-cloudinary.ts --apply
 *       npx tsx --env-file=.env.local scripts/migrate-images-to-cloudinary.ts --apply --table=blog_posts
 *       npx tsx --env-file=.env.local scripts/migrate-images-to-cloudinary.ts --apply --limit=1
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadImageRef, uploadTreeImages, CLD_FOLDER } from "@/lib/cloudinary/upload";
import { isCloudinaryConfigured } from "@/lib/cloudinary/client";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";
import { renderBlockTree } from "@/lib/engine/blockTree";
import { blogRenderCtx } from "@/lib/blog";

const APPLY = process.argv.includes("--apply");
const TABLE = process.argv.find((a) => a.startsWith("--table="))?.split("=")[1] ?? null;
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0) || null;

const wants = (t: string) => !TABLE || TABLE === t;
const isInline = (v: unknown): v is string => typeof v === "string" && v.startsWith("data:");
const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;

/** Bytes of every inline image in a value, so the report can show what was actually removed. */
function inlineBytes(value: unknown): number {
  if (typeof value === "string") return value.startsWith("data:") ? value.length : 0;
  if (!value || typeof value !== "object") return 0;
  return Object.values(value as Record<string, unknown>).reduce<number>((n, v) => n + inlineBytes(v), 0);
}

const totals = { rows: 0, before: 0, after: 0 };
function record(before: number, after: number) {
  totals.rows++;
  totals.before += before;
  totals.after += after;
}

/**
 * Has --limit been reached?
 *
 * Counts rows that actually HAD inline images, not rows scanned. `--limit=1` on the candidate query
 * silently did nothing when the lowest-id post happened to have no image — which is the worst
 * outcome for a flag whose entire purpose is a careful one-row first pass: it reports success
 * having tested nothing.
 */
const done = () => LIMIT !== null && totals.rows >= LIMIT;

async function main() {
  if (!isCloudinaryConfigured()) {
    console.error("Cloudinary is not configured — set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.");
    process.exit(1);
  }
  const db = createAdminClient();
  console.log(APPLY ? "APPLYING\n" : "DRY RUN — nothing will be written. Add --apply to commit.\n");

  // ---- blog posts: featured image + the post's own tree, then re-render html -------------------
  if (wants("blog_posts")) {
    const { data: ids, error } = await db
      .from("blog_posts")
      .select("id")
      .order("id")
      .limit(1000);
    if (error) throw error;
    for (const { id } of (ids ?? []) as any[]) {
      const { data: post } = await db
        .from("blog_posts")
        .select("id, title, workspace_id, user_id, featured_image_url, page_copy")
        .eq("id", id)
        .maybeSingle();
      if (!post) continue;
      if (done()) break;
      const before = inlineBytes(post.featured_image_url) + inlineBytes(post.page_copy);
      if (before === 0) continue;
      const owner = { workspaceId: post.workspace_id, userId: post.user_id };
      console.log(`blog_posts   ${post.id}  ${kb(before)}  ${String(post.title).slice(0, 48)}`);
      if (!APPLY) { record(before, 0); continue; }

      const featured = await uploadImageRef(db, post.featured_image_url, CLD_FOLDER.blog, owner);
      const tree = post.page_copy;
      if (tree?.blocks) await uploadTreeImages(db, tree, CLD_FOLDER.blog, owner);

      const patch: Record<string, unknown> = { featured_image_url: featured };
      if (tree?.blocks) {
        patch.page_copy = tree;
        // Baked at write time — rewriting page_copy without this leaves the served post unchanged.
        patch.html = renderBlockTree(tree, blogRenderCtx());
      }
      const { error: upErr } = await db.from("blog_posts").update(patch).eq("id", post.id);
      if (upErr) { console.error("  ! failed:", upErr.message); continue; }
      record(before, inlineBytes(featured) + inlineBytes(tree));
    }
  }

  // ---- blog settings: author avatar ------------------------------------------------------------
  if (wants("blog_settings")) {
    const { data, error } = await db.from("blog_settings").select("workspace_id, user_id, author_avatar_url");
    if (error) throw error;
    for (const row of (data ?? []) as any[]) {
      if (done()) break;
      const before = inlineBytes(row.author_avatar_url);
      if (before === 0) continue;
      console.log(`blog_settings ws=${row.workspace_id}  ${kb(before)}`);
      if (!APPLY) { record(before, 0); continue; }
      const url = await uploadImageRef(db, row.author_avatar_url, CLD_FOLDER.blogAuthor, {
        workspaceId: row.workspace_id,
        userId: row.user_id,
      });
      const { error: upErr } = await db
        .from("blog_settings")
        .update({ author_avatar_url: url })
        .eq("workspace_id", row.workspace_id);
      if (upErr) { console.error("  ! failed:", upErr.message); continue; }
      record(before, inlineBytes(url));
    }
  }

  // ---- campaign creatives: per-angle generated images ------------------------------------------
  if (wants("campaign_creatives")) {
    // IDs first, then one row at a time. Selecting image_data_url for every row at once pulls
    // megabytes per row into a single response and the connection is dropped (ECONNRESET) — found
    // by the dry run before any writes, which is what the dry run is for.
    const { data: ids, error } = await db
      .from("campaign_creatives")
      .select("id")
      .not("image_data_url", "is", null)
      .order("id")
      .limit(1000);
    if (error) throw error;
    for (const { id } of (ids ?? []) as any[]) {
      const { data: row } = await db
        .from("campaign_creatives")
        .select("id, workspace_id, user_id, image_data_url")
        .eq("id", id)
        .maybeSingle();
      if (!row) continue;
      if (done()) break;
      const before = inlineBytes(row.image_data_url);
      if (before === 0) continue;
      console.log(`campaign_creatives ${row.id}  ${kb(before)}`);
      if (!APPLY) { record(before, 0); continue; }
      const url = await uploadImageRef(db, row.image_data_url, CLD_FOLDER.creative, {
        workspaceId: row.workspace_id,
        userId: row.user_id,
      });
      const { error: upErr } = await db.from("campaign_creatives").update({ image_data_url: url }).eq("id", row.id);
      if (upErr) { console.error("  ! failed:", upErr.message); continue; }
      record(before, inlineBytes(url));
    }
  }

  // ---- campaigns (+ their variants and steps), then ONE re-render per campaign ------------------
  //
  // Variants and steps are handled inside this loop rather than as their own passes, because
  // rerenderFunnelSequence rebuilds all three from page_copy in a single call. Doing them
  // separately would mean re-rendering the same funnel two or three times.
  if (wants("campaigns")) {
    // Same reason as above, and more acute here: ad_creative_image_data_url alone permits ~10 MB.
    const { data: ids, error } = await db
      .from("campaigns")
      .select("id")
      .order("id")
      .limit(1000);
    if (error) throw error;

    for (const { id: campaignId } of (ids ?? []) as any[]) {
      const { data: c } = await db
        .from("campaigns")
        .select("id, workspace_id, user_id, embedded_image_data_url, ad_creative_image_data_url, page_copy")
        .eq("id", campaignId)
        .maybeSingle();
      if (!c) continue;
      if (done()) break;
      const owner = { workspaceId: c.workspace_id, userId: c.user_id };

      const { data: variants } = await db
        .from("bridge_variants")
        .select("id, embedded_image_data_url, page_copy")
        .eq("campaign_id", c.id);
      const { data: steps } = await db
        .from("funnel_steps")
        .select("id, embedded_image_data_url, page_copy")
        .eq("campaign_id", c.id);

      const before =
        inlineBytes(c.embedded_image_data_url) +
        inlineBytes(c.ad_creative_image_data_url) +
        inlineBytes(c.page_copy) +
        inlineBytes(variants) +
        inlineBytes(steps);
      if (before === 0) continue;

      console.log(`campaigns    ${c.id}  ${kb(before)}  (+${(variants ?? []).length} variants, ${(steps ?? []).length} steps)`);
      if (!APPLY) { record(before, 0); continue; }

      const hero = await uploadImageRef(db, c.embedded_image_data_url, CLD_FOLDER.campaign, owner);
      const adCreative = await uploadImageRef(db, c.ad_creative_image_data_url, CLD_FOLDER.creative, owner);
      if (c.page_copy?.blocks) await uploadTreeImages(db, c.page_copy, CLD_FOLDER.page, owner);
      await db
        .from("campaigns")
        .update({
          embedded_image_data_url: hero,
          ad_creative_image_data_url: adCreative,
          ...(c.page_copy?.blocks ? { page_copy: c.page_copy } : {}),
        })
        .eq("id", c.id);

      for (const v of (variants ?? []) as any[]) {
        const vHero = await uploadImageRef(db, v.embedded_image_data_url, CLD_FOLDER.page, owner);
        if (v.page_copy?.blocks) await uploadTreeImages(db, v.page_copy, CLD_FOLDER.page, owner);
        await db
          .from("bridge_variants")
          .update({
            embedded_image_data_url: vHero,
            ...(v.page_copy?.blocks ? { page_copy: v.page_copy } : {}),
          })
          .eq("id", v.id);
      }
      for (const st of (steps ?? []) as any[]) {
        const sHero = await uploadImageRef(db, st.embedded_image_data_url, CLD_FOLDER.page, owner);
        if (st.page_copy?.blocks) await uploadTreeImages(db, st.page_copy, CLD_FOLDER.page, owner);
        await db
          .from("funnel_steps")
          .update({
            embedded_image_data_url: sHero,
            ...(st.page_copy?.blocks ? { page_copy: st.page_copy } : {}),
          })
          .eq("id", st.id);
      }

      // The whole funnel's html, from the page_copy just written. Not optional: without it the
      // served pages keep the base64 they were baked with.
      try {
        await rerenderFunnelSequence(db, c.id, c.workspace_id);
      } catch (err) {
        console.error("  ! re-render failed — the columns moved but the served html did not:", (err as Error).message);
      }

      const after =
        inlineBytes(hero) + inlineBytes(adCreative) + inlineBytes(c.page_copy) +
        inlineBytes(variants) + inlineBytes(steps);
      record(before, after);
    }
  }

  console.log(
    `\n${APPLY ? "Migrated" : "Would migrate"} ${totals.rows} rows — ` +
      `${kb(totals.before)} of inline images${APPLY ? ` -> ${kb(totals.after)} left inline` : ""}.`
  );
  if (!APPLY) console.log("Re-run with --apply to commit.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
