import { searchMarketplace, type DiscoverPayload } from "./clickbank";
import { fetchSalesPage } from "./salespage";
import { completeJSON, COMPLIANCE_SYSTEM } from "./anthropic";
import { upsertProduct, db } from "./core";
import { buildHoplink, type Network } from "./renderPages";

export type DiscoverJobPayload = DiscoverPayload & { niche: string };

// Single-stage: fetch the marketplace, save bare rows immediately (visible in the dashboard
// within seconds — the biggest "feels real-time" win), then verify+score the batch in parallel/
// one LLM call rather than per-product agentic browsing.
//
// Only 'clickbank' has a real marketplace-search implementation today — searchMarketplace() is
// ClickBank-specific (lib/engine/clickbank.ts). A digistore24 dispatch branch lands here once its
// own marketplace-discovery API shape is confirmed live (see Phase G's discovery-spike follow-on
// in the plan doc); the caller (lib/engine/worker.ts) already validates the requested network is
// one this function actually supports before invoking it.
export async function runDiscoverProducts(
  userId: string,
  jobId: string,
  network: Network,
  affiliateId: string,
  payload: DiscoverJobPayload
): Promise<{ saved: number }> {
  const hits = await searchMarketplace(payload);

  for (const hit of hits) {
    const vendorId = hit.site;
    if (!vendorId || !hit.title) continue;
    const hoplink = buildHoplink(network, affiliateId, vendorId, "page");
    await upsertProduct(userId, {
      network,
      vendor_id: vendorId,
      niche: payload.niche,
      product_title: hit.title,
      description: hit.description,
      gravity: hit.marketplaceStats?.gravity ?? null,
      initial_sale: hit.marketplaceStats?.initialDollarsPerSale ?? null,
      avg_sale: hit.marketplaceStats?.averageDollarsPerSale ?? null,
      recurring: hit.marketplaceStats?.totalRebill ?? null,
      sales_page_url: hit.url,
      affiliate_page_url: hit.affiliateToolsUrl,
      hoplink,
      status: "New",
      page_verified: false,
    });
  }

  const verifiable = hits.filter((h) => h.site && h.title);
  if (verifiable.length === 0) return { saved: 0 };

  const verifications = await Promise.allSettled(
    verifiable.map((hit) => (hit.url ? fetchSalesPage(hit.url) : Promise.resolve({ ok: false, text: null, imageCandidates: [] })))
  );

  const scoreInput = verifiable.map((hit, i) => {
    const v = verifications[i];
    const text = v.status === "fulfilled" ? v.value.text : null;
    return {
      vendor_id: hit.site,
      title: hit.title,
      description: hit.description,
      stats: hit.marketplaceStats,
      sales_text: text ? text.slice(0, 3000) : null,
    };
  });

  const scored = await completeJSON<{
    items: { vendor_id: string; score: number; angle_notes: string; page_verified: boolean }[];
  }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `Score each of these ClickBank products for promotability (1-10) and write 1-2 sentences of angle notes (curiosity/mechanism angle, ad-review risk) for each, grounded only in the given sales_text. Set page_verified=false when sales_text is null and note "page not verified" as part of angle_notes for that item.\n\n${JSON.stringify(scoreInput, null, 2)}`,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              vendor_id: { type: "string" },
              score: { type: "integer" },
              angle_notes: { type: "string" },
              page_verified: { type: "boolean" },
            },
            required: ["vendor_id", "score", "angle_notes", "page_verified"],
          },
        },
      },
      required: ["items"],
    },
    maxTokens: 4000,
    usage: { userId, jobId, jobType: "discover_products", stage: "score" },
  });

  for (const item of scored.items) {
    await db
      .from("products")
      .update({
        score: item.score,
        angle_notes: item.angle_notes,
        page_verified: item.page_verified,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .ilike("vendor_id", item.vendor_id);
  }

  return { saved: verifiable.length };
}
