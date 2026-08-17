import type { SupabaseClient } from "@supabase/supabase-js";
import { newBlockId, type PageBlockTree } from "@/lib/engine/renderPages";
import { withOfferLinks } from "@/lib/engine/build";
import { blogRenderCtx, renderBlockTree } from "@/lib/blog";

const CTA_TEXT = "Check the official page";

/**
 * Put a campaign's affiliate link into its blog copy.
 *
 * This exists because of the ordering the app now has: nothing derives an affiliate link, so a kit
 * is routinely built BEFORE one is pasted. `withOfferLinks(md, null)` strips the `{{OFFER_LINK}}`
 * placeholder rather than publishing it to readers — correct at the time, and it means the article
 * would stay permanently unmonetized once the link finally arrived. So setting the link runs this,
 * the same way it already re-renders every funnel page.
 *
 * Fixes BOTH halves, because they are stored separately and the reader only ever sees the second:
 *   campaigns.blog_md  — the source markdown
 *   blog_posts         — content_md, PLUS a real CTA button in the block tree and `html` re-rendered
 *
 * Purely ADDITIVE and idempotent: one button block and one markdown line, skipped entirely for any
 * row already containing this link. It never rewrites existing copy, so a hand-edited article keeps
 * every edit and undoing it is "delete the last block".
 */
export async function applyOfferLinksToCampaign(
  db: SupabaseClient,
  campaignId: string,
  hoplink: string
): Promise<number> {
  if (!hoplink) return 0;
  let changed = 0;

  const { data: campaign } = await db
    .from("campaigns")
    .select("blog_md")
    .eq("id", campaignId)
    .maybeSingle();
  const md: string = campaign?.blog_md ?? "";
  if (md && !md.includes(hoplink)) {
    const fixed = withOfferLinks(md, hoplink);
    if (fixed !== md) {
      await db.from("campaigns").update({ blog_md: fixed }).eq("id", campaignId);
      changed++;
    }
  }

  const { data: posts } = await db
    .from("blog_posts")
    .select("id, content_md, page_copy")
    .eq("campaign_id", campaignId);

  for (const p of (posts ?? []) as any[]) {
    const tree = p.page_copy as PageBlockTree | null;
    if (!tree || !Array.isArray(tree.blocks)) continue;
    if (JSON.stringify(tree).includes(hoplink)) continue;

    // A button block rather than an inline markdown link: it is a first-class validated construct
    // guaranteed to render a real <a href>, and a CTA is the right shape for the end of an article.
    const cta = {
      id: newBlockId(),
      type: "button" as const,
      style: {},
      content: { text: CTA_TEXT, action: { kind: "link" as const, href: hoplink } },
    };
    const blocks = [...tree.blocks];
    // Into the LAST section, so it lands at the end of the body rather than after the disclosure —
    // renderBlockTree hoists the disclosure last regardless, but the section keeps it inside the
    // article's own measure.
    const lastSection = [...blocks].reverse().find((b: any) => b.type === "section") as any;
    if (lastSection) lastSection.children = [...lastSection.children, cta];
    else blocks.push(cta as any);

    const nextTree = { ...tree, blocks };
    await db
      .from("blog_posts")
      .update({
        page_copy: nextTree,
        html: renderBlockTree(nextTree as PageBlockTree, blogRenderCtx()),
        content_md: withOfferLinks(p.content_md ?? "", hoplink),
      })
      .eq("id", p.id);
    changed++;
  }

  return changed;
}
