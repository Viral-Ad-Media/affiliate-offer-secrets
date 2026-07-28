// Shared job-queue DB logic — used by both scripts/engine.ts (manual/debug CLI) and the
// automated worker (lib/engine/worker.ts). One implementation, so the two paths can never
// diverge on upsert/dedupe semantics.
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Lazy singleton — constructed on first real use, not at module-import time. Next.js dev server
// can evaluate a route's module graph during an early analysis pass before its networking is
// fully live; a client built then can end up with a broken fetch/DNS path for its lifetime.
// lib/supabase/server.ts sidesteps this by building fresh per-request, which is reliable —
// this Proxy gets the same effect without touching every db.from()/db.rpc() call site.
let _db: AdminClient | null = null;
export const db: AdminClient = new Proxy({} as AdminClient, {
  get(_target, prop, receiver) {
    if (!_db) _db = createAdminClient();
    return Reflect.get(_db as object, prop, receiver);
  },
});

export const PRODUCT_FIELDS = [
  "network",
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
  "bridge_html",
  "blog_md",
  "social_md",
  "email_md",
  "images_json",
  "notes",
] as const;

// Atomic INSERT ... ON CONFLICT via the upsert_product() RPC (supabase/migrations/
// 0004_atomic_product_upsert.sql) — a client-side check-then-insert-or-update here would race
// under conditions the automated worker genuinely hits (the same vendor_id appearing twice in
// one marketplace response, a retried job re-processing hits an earlier attempt already saved).
export async function upsertProduct(userId: string, meta: any): Promise<string> {
  if (!meta.vendor_id || !meta.product_title) {
    throw new Error("product meta must include at least {vendor_id, product_title}");
  }
  const payload: Record<string, unknown> = {};
  for (const f of PRODUCT_FIELDS) {
    if (meta[f] !== undefined && meta[f] !== null) payload[f] = meta[f];
  }
  const { data, error } = await db.rpc("upsert_product", { p_user_id: userId, p_meta: payload });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
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
