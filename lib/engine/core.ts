// Shared job-queue DB logic — used by both scripts/engine.ts (manual/debug CLI) and the
// automated worker (lib/engine/worker.ts). One implementation, so the two paths can never
// diverge on upsert/dedupe semantics.
import { createAdminClient } from "@/lib/supabase/admin";

export const db = createAdminClient();

export const PRODUCT_FIELDS = [
  "vendor_id",
  "niche",
  "product_title",
  "description",
  "gravity",
  "initial_sale",
  "avg_sale",
  "recurring",
  "commission_pct",
  "sales_page_url",
  "affiliate_page_url",
  "hoplink",
  "score",
  "angle_notes",
  "page_verified",
  "status",
  "assets_link",
  "date_added",
] as const;

export const CAMPAIGN_FIELDS = [
  "folder",
  "drive_link",
  "hoplinks_txt",
  "fb_ads_md",
  "tiktok_md",
  "landing_md",
  "presell_html",
  "bridge_html",
  "blog_md",
  "social_md",
  "email_md",
  "images_json",
  "notes",
] as const;

export async function upsertProduct(userId: string, meta: any): Promise<string> {
  if (!meta.vendor_id || !meta.product_title) {
    throw new Error("product meta must include at least {vendor_id, product_title}");
  }
  const values: Record<string, unknown> = { user_id: userId };
  for (const f of PRODUCT_FIELDS) values[f] = meta[f] ?? null;
  values.niche = values.niche ?? "unknown";
  values.date_added = values.date_added ?? new Date().toISOString().slice(0, 10);

  const { data: existing } = await db
    .from("products")
    .select("id, gravity, initial_sale, avg_sale, recurring, commission_pct, status, notes")
    .eq("user_id", userId)
    .ilike("vendor_id", meta.vendor_id)
    .maybeSingle();

  if (existing) {
    // Fresh marketplace stats always win; other fields only fill gaps left null before.
    const overwrite = ["gravity", "initial_sale", "avg_sale", "recurring", "commission_pct"];
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const f of PRODUCT_FIELDS) {
      const incoming = values[f];
      if (overwrite.includes(f)) {
        if (incoming != null) patch[f] = incoming;
      } else if ((existing as any)[f] == null && incoming != null) {
        patch[f] = incoming;
      }
    }
    const { error } = await db.from("products").update(patch).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id as string;
  }

  const { data: created, error } = await db
    .from("products")
    .insert(values)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created!.id as string;
}

export async function upsertCampaign(
  productId: string,
  meta: any,
  status?: string
): Promise<string> {
  const { data: product } = await db
    .from("products")
    .select("id, user_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product) throw new Error(`No product ${productId}`);

  const values: Record<string, unknown> = {};
  for (const f of CAMPAIGN_FIELDS) if (meta[f] !== undefined) values[f] = meta[f];

  const { data: existing } = await db
    .from("campaigns")
    .select("id")
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    const patch = {
      ...values,
      updated_at: new Date().toISOString(),
      ...(status ? { status } : {}),
    };
    const { error } = await db.from("campaigns").update(patch).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id as string;
  }

  const { data: created, error } = await db
    .from("campaigns")
    .insert({
      user_id: product!.user_id,
      product_id: productId,
      ...values,
      ...(status ? { status } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created!.id as string;
}

export async function jobContext(job: any) {
  const payload = job.payload ?? {};
  const ctx: any = { job: { ...job, payload } };
  if (payload.product_id) {
    const { data: product } = await db
      .from("products")
      .select("*")
      .eq("id", payload.product_id)
      .maybeSingle();
    ctx.product = product ?? null;
    const { data: campaign } = await db
      .from("campaigns")
      .select("*")
      .eq("product_id", payload.product_id)
      .maybeSingle();
    ctx.campaign = campaign ?? null;
  }
  if (job.type === "discover_products") {
    const { data: known } = await db
      .from("products")
      .select("vendor_id")
      .eq("user_id", job.user_id)
      .order("vendor_id");
    ctx.known_vendor_ids = (known ?? []).map((r) => r.vendor_id);
  }
  const { data: profile } = await db
    .from("profiles")
    .select("nickname")
    .eq("id", job.user_id)
    .maybeSingle();
  ctx.nickname = profile?.nickname ?? null;
  ctx.user_id = job.user_id;
  return ctx;
}
