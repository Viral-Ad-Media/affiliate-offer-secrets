/**
 * Move in-copy affiliate disclosures out of the body of already-generated content.
 *
 * The blog prompt used to ask for "an affiliate disclosure line near the top or bottom", and the
 * model always chose the top. Measured before writing this: 13 of 14 posts, 11 of them PUBLISHED,
 * open with one — so their meta description, their search-result snippet and their blog-index card
 * all read "Affiliate Disclosure: This article contains affiliate links…". The least useful
 * sentence available, in the slot that decides whether anyone clicks.
 *
 * Nothing is lost by removing it. Every post's block tree already ENDS with a code-owned
 * `disclosure` block (markdownToBlockTree appends one, renderBlockTree hoists it last), so the
 * page keeps its disclosure and gains correct placement — content rule 3 is satisfied throughout,
 * before and after.
 *
 * Operates on the BLOCK TREE, not by re-parsing the markdown. Regenerating a tree from content_md
 * would silently discard anything edited in the WYSIWYG editor since import; dropping matching
 * paragraph blocks from the stored tree preserves every other edit.
 *
 * Run:  npx tsx --env-file=.env.local scripts/fix-disclosure-placement.ts           (dry run)
 *       npx tsx --env-file=.env.local scripts/fix-disclosure-placement.ts --apply
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isDisclosureText,
  stripDisclosureParagraphs,
  stripTrailingDisclosureSentence,
  stripParentheticalDisclosure,
} from "@/lib/disclosure";
import { blogRenderCtx, renderBlockTree } from "@/lib/blog";
import type { PageBlockTree } from "@/lib/engine/renderPages";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";

const APPLY = process.argv.includes("--apply");

/**
 * Two different removals, because the model writes disclosures two different ways.
 *
 *   1. A whole paragraph that IS a disclosure — dropped.
 *   2. A labelled disclosure welded onto the end of a real paragraph — cut, keeping the paragraph.
 *
 * Locked `disclosure` blocks are never touched: they are the code-owned one that must survive.
 */
function stripFromTree(tree: PageBlockTree): { tree: PageBlockTree; removed: number; trimmed: number } {
  let removed = 0;
  let trimmed = 0;
  const walk = (blocks: any[]): any[] =>
    blocks
      .filter((b) => {
        if (b?.type === "paragraph" && isDisclosureText(b?.content?.text)) {
          removed++;
          return false;
        }
        return true;
      })
      .map((b) => {
        let next = b;
        if (b?.type === "paragraph") {
          // Trailing-labelled first, then parenthesised — a paragraph can carry either, and the
          // two cuts are independent.
          let text: string = b?.content?.text ?? "";
          const trailing = stripTrailingDisclosureSentence(text);
          if (trailing !== null) text = trailing;
          const paren = stripParentheticalDisclosure(text);
          if (paren !== null) text = paren;
          if (text !== (b?.content?.text ?? "")) {
            trimmed++;
            next = { ...b, content: { ...b.content, text } };
          }
        }
        return Array.isArray(next?.children) ? { ...next, children: walk(next.children) } : next;
      });
  return { tree: { ...tree, blocks: walk(tree.blocks ?? []) }, removed, trimmed };
}

async function main() {
  const db = createAdminClient();
  let planned = 0;

  const { data: posts, error } = await db
    .from("blog_posts")
    .select("id, title, status, content_md, page_copy, excerpt, seo_description");
  if (error) throw error;

  for (const p of (posts ?? []) as any[]) {
    const tree = p.page_copy as PageBlockTree | null;
    const patch: Record<string, unknown> = {};

    if (tree && Array.isArray(tree.blocks)) {
      const { tree: next, removed, trimmed } = stripFromTree(tree);
      if (removed + trimmed > 0) {
        patch.page_copy = next;
        patch.html = renderBlockTree(next, blogRenderCtx());
      }
    }

    const nextMd = stripDisclosureParagraphs(p.content_md ?? "");
    if (nextMd !== (p.content_md ?? "")) patch.content_md = nextMd;

    // A stored excerpt or description that IS the disclosure is worse than none: null falls back
    // to postExcerpt(), which now skips disclosure paragraphs and returns real opening prose.
    if (isDisclosureText(p.excerpt)) patch.excerpt = null;
    if (isDisclosureText(p.seo_description)) patch.seo_description = null;

    if (Object.keys(patch).length === 0) continue;
    planned++;
    console.log(`FIX   post ${p.id} [${p.status}] "${p.title}" — ${Object.keys(patch).join(", ")}`);
    if (APPLY) {
      const { error: e } = await db.from("blog_posts").update(patch).eq("id", p.id);
      if (e) console.log(`      ! failed: ${e.message}`);
    }
  }

  // The source markdown on the campaign, so a re-import or a rebuild doesn't reintroduce it.
  const { data: campaigns } = await db
    .from("campaigns")
    .select("id, blog_md, blog_excerpt, blog_seo_description")
    .not("blog_md", "is", null);
  for (const c of (campaigns ?? []) as any[]) {
    const patch: Record<string, unknown> = {};
    const next = stripDisclosureParagraphs(c.blog_md ?? "");
    if (next !== c.blog_md) patch.blog_md = next;
    if (isDisclosureText(c.blog_excerpt)) patch.blog_excerpt = null;
    if (isDisclosureText(c.blog_seo_description)) patch.blog_seo_description = null;
    if (Object.keys(patch).length === 0) continue;
    planned++;
    console.log(`FIX   campaign ${c.id} blog_md — ${Object.keys(patch).join(", ")}`);
    if (APPLY) {
      const { error: e } = await db.from("campaigns").update(patch).eq("id", c.id);
      if (e) console.log(`      ! failed: ${e.message}`);
    }
  }

  // ---- funnel pages -------------------------------------------------------------------------
  // Same two shapes, and the same guarantee: every funnel tree carries the code-owned locked
  // disclosure block, which renderBlockTree hoists to the end, so removing an in-copy duplicate
  // leaves the page compliant AND puts the notice where an ad reviewer expects it.
  //
  // page_copy only — bridge_html is BAKED at write time, so the re-render is not optional. Done
  // through the real rerenderFunnelSequence rather than a second render path here.
  const { data: funnels } = await db
    .from("campaigns")
    .select("id, workspace_id, page_copy, seo_description")
    .not("page_copy", "is", null);

  const touchedCampaigns: { id: string; ws: string }[] = [];
  for (const c of (funnels ?? []) as any[]) {
    const patch: Record<string, unknown> = {};
    const { tree: next, removed, trimmed } = stripFromTree(c.page_copy as PageBlockTree);
    if (removed + trimmed > 0) patch.page_copy = next;
    if (isDisclosureText(c.seo_description)) patch.seo_description = null;
    if (Object.keys(patch).length === 0) continue;
    planned++;
    console.log(
      `FIX   funnel ${c.id} — ${removed} block(s) dropped, ${trimmed} paragraph(s) trimmed`
    );
    if (APPLY) {
      const { error: e } = await db.from("campaigns").update(patch).eq("id", c.id);
      if (e) console.log(`      ! failed: ${e.message}`);
      else if (patch.page_copy) touchedCampaigns.push({ id: c.id, ws: c.workspace_id });
    }
  }

  const { data: variants } = await db
    .from("bridge_variants")
    .select("id, campaign_id, page_copy")
    .not("page_copy", "is", null);
  for (const v of (variants ?? []) as any[]) {
    const { tree: next, removed, trimmed } = stripFromTree(v.page_copy as PageBlockTree);
    if (removed + trimmed === 0) continue;
    planned++;
    console.log(`FIX   variant ${v.id} — ${removed} dropped, ${trimmed} trimmed`);
    if (APPLY) {
      const { error: e } = await db.from("bridge_variants").update({ page_copy: next }).eq("id", v.id);
      if (e) console.log(`      ! failed: ${e.message}`);
    }
  }

  for (const { id, ws } of touchedCampaigns) {
    try {
      await rerenderFunnelSequence(db, id, ws);
      console.log(`      re-rendered funnel ${id}`);
    } catch (e: any) {
      console.log(`      ! re-render failed for ${id}: ${e?.message ?? e}`);
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — ${planned} change(s).`);
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
