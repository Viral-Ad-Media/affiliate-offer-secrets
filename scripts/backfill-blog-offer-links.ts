/**
 * One-off backfill: put a tracked affiliate link into blog copy generated before the fix.
 *
 * Every kit article written before `withOfferLinks` shipped has no offer link at all — the tid was
 * computed and discarded (see the commit that added OFFER_LINK_TOKEN). This repairs BOTH halves:
 *
 *   campaigns.blog_md   — the source markdown, via withOfferLinks (append path, no placeholder)
 *   blog_posts          — content_md the same way, PLUS a real CTA button appended to the block
 *                         tree and the html re-rendered, because the published page serves `html`
 *                         and fixing the markdown alone would change nothing a reader sees.
 *
 * Purely ADDITIVE and idempotent: it appends one button block and one markdown line, and skips any
 * row that already contains its hoplink. It never rewrites existing copy, so a hand-edited article
 * keeps every edit — and undoing it is "delete the last block".
 *
 * Run:  npx tsx scripts/backfill-blog-offer-links.ts          (dry run, prints the plan)
 *       npx tsx scripts/backfill-blog-offer-links.ts --apply
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { buildHoplink, newBlockId, type PageBlockTree } from "@/lib/engine/renderPages";
import { withOfferLinks } from "@/lib/engine/build";
import { blogRenderCtx, renderBlockTree } from "@/lib/blog";

const APPLY = process.argv.includes("--apply");
const CTA_TEXT = "Check the official page";

async function main() {
  const db = createAdminClient();

  const { data: campaigns, error } = await db
    .from("campaigns")
    .select("id, workspace_id, blog_md, products(network, vendor_id, hoplink_override)")
    .not("blog_md", "is", null);
  if (error) throw error;

  // Affiliate ids are per (workspace, network) — resolve once rather than per row.
  const { data: conns } = await db.from("network_connections").select("workspace_id, network, affiliate_id");
  const affiliateFor = (ws: string, network: string) =>
    (conns ?? []).find((c: any) => c.workspace_id === ws && c.network === network)?.affiliate_id ?? null;

  let planned = 0;
  let skipped = 0;

  for (const c of (campaigns ?? []) as any[]) {
    const md: string = c.blog_md ?? "";
    if (!md.trim()) continue;

    const product = Array.isArray(c.products) ? c.products[0] : c.products;
    if (!product) {
      console.log(`SKIP  campaign ${c.id} — no product, so there is no offer to link to`);
      skipped++;
      continue;
    }
    const affiliateId = affiliateFor(c.workspace_id, product.network);
    if (!affiliateId) {
      console.log(`SKIP  campaign ${c.id} — no ${product.network} connection for its workspace`);
      skipped++;
      continue;
    }

    const hoplink = buildHoplink(product.network, affiliateId, product.vendor_id, "blog", product.hoplink_override);

    // ---- campaigns.blog_md -------------------------------------------------------------------
    if (!md.includes(hoplink)) {
      const fixed = withOfferLinks(md, hoplink);
      console.log(`FIX   campaign ${c.id} blog_md  (+${fixed.length - md.length} chars)`);
      planned++;
      if (APPLY) {
        const { error: e } = await db.from("campaigns").update({ blog_md: fixed }).eq("id", c.id);
        if (e) console.log(`      ! campaigns update failed: ${e.message}`);
      }
    }

    // ---- blog_posts (what readers actually see) ----------------------------------------------
    const { data: posts } = await db
      .from("blog_posts")
      .select("id, title, status, content_md, page_copy")
      .eq("campaign_id", c.id);

    for (const p of (posts ?? []) as any[]) {
      const tree = p.page_copy as PageBlockTree | null;
      const treeJson = JSON.stringify(tree ?? {});
      if (treeJson.includes(hoplink)) {
        console.log(`SKIP  post ${p.id} "${p.title}" — already links to its offer`);
        skipped++;
        continue;
      }
      if (!tree || !Array.isArray(tree.blocks)) {
        console.log(`SKIP  post ${p.id} "${p.title}" — no block tree to append to`);
        skipped++;
        continue;
      }

      // A button block, not an inline markdown link: it is a first-class validated construct that
      // is guaranteed to render a real <a href>, and a CTA is the right shape for this anyway.
      const cta = {
        id: newBlockId(),
        type: "button" as const,
        style: {},
        content: { text: CTA_TEXT, action: { kind: "link" as const, href: hoplink } },
      };
      const blocks = [...tree.blocks];
      // Into the LAST section so it lands at the end of the article body rather than after the
      // disclosure — renderBlockTree hoists the disclosure last regardless.
      const lastSection = [...blocks].reverse().find((b: any) => b.type === "section") as any;
      if (lastSection) lastSection.children = [...lastSection.children, cta];
      else blocks.push(cta as any);

      const nextTree = { ...tree, blocks };
      const html = renderBlockTree(nextTree as PageBlockTree, blogRenderCtx());
      const nextMd = withOfferLinks(p.content_md ?? "", hoplink);

      console.log(`FIX   post ${p.id} [${p.status}] "${p.title}" — CTA appended + html re-rendered`);
      planned++;
      if (APPLY) {
        const { error: e } = await db
          .from("blog_posts")
          .update({ page_copy: nextTree, html, content_md: nextMd })
          .eq("id", p.id);
        if (e) console.log(`      ! blog_posts update failed: ${e.message}`);
      }
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — ${planned} change(s), ${skipped} skipped.`);
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
