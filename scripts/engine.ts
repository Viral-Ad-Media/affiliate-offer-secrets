/**
 * Engine CLI — how Claude Code reads and writes the jobs queue. Runs with the Supabase
 * service-role key, so it crosses tenant boundaries (RLS doesn't apply) — this is the one
 * trusted background process allowed to touch every user's rows.
 *
 *   npm run engine -- pending [--user <uuid>]       list pending/running jobs + context (JSON);
 *                                                    all tenants by default, or one with --user
 *   npm run engine -- claim <jobId>                 mark a job running, print its full context
 *   npm run engine -- add-product --user <uuid> --meta <p.json>
 *                                                    upsert one discovered product for a tenant
 *                                                    (dedupe: user_id + vendor_id)
 *   npm run engine -- save-campaign <productId> --meta <camp.json>
 *                                                    upsert campaign assets (tenant inferred
 *                                                    from the product row — no --user needed)
 *   npm run engine -- complete <jobId> [--meta <file.json>]
 *   npm run engine -- fail <jobId> --message "<why>"
 *
 * `complete` semantics by job type:
 *   discover_products — meta may include {result} summary; nothing else required
 *                       (products should already be saved row-by-row via add-product).
 *   build_campaign    — meta may be campaign fields (same shape as save-campaign);
 *                       the campaign is upserted, marked ready, and the product
 *                       status is set to Promoting.
 *
 * All UUID primary keys mean most commands don't need explicit tenant scoping — the job or
 * product row itself carries user_id, and that's used for every downstream write.
 */
import fs from "fs";
import { createAdminClient } from "../lib/supabase/admin";

const db = createAdminClient();

const PRODUCT_FIELDS = [
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

const CAMPAIGN_FIELDS = [
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

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function out(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function readMeta(required = false): any {
  const metaPath = arg("--meta");
  if (!metaPath) {
    if (required) die("--meta <file.json> is required");
    return {};
  }
  return JSON.parse(fs.readFileSync(metaPath, "utf8"));
}

async function upsertProduct(userId: string, meta: any) {
  if (!meta.vendor_id || !meta.product_title) {
    die("product meta must include at least {vendor_id, product_title}");
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
    if (error) die(error.message);
    out({ ok: true, product_id: existing.id, updated: true });
    return existing.id as string;
  }

  const { data: created, error } = await db
    .from("products")
    .insert(values)
    .select("id")
    .single();
  if (error) die(error.message);
  out({ ok: true, product_id: created!.id, created: true });
  return created!.id as string;
}

async function upsertCampaign(productId: string, meta: any, status?: string) {
  const { data: product } = await db
    .from("products")
    .select("id, user_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product) die(`No product ${productId}`);

  const values: Record<string, unknown> = {};
  for (const f of CAMPAIGN_FIELDS) if (meta[f] !== undefined) values[f] = meta[f];

  const { data: existing } = await db
    .from("campaigns")
    .select("id")
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    const patch = { ...values, updated_at: new Date().toISOString(), ...(status ? { status } : {}) };
    const { error } = await db.from("campaigns").update(patch).eq("id", existing.id);
    if (error) die(error.message);
    out({ ok: true, campaign_id: existing.id, updated: true });
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
  if (error) die(error.message);
  out({ ok: true, campaign_id: created!.id, created: true });
  return created!.id as string;
}

async function jobContext(job: any) {
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

async function main() {
  const cmd = process.argv[2];

  if (cmd === "pending") {
    const userId = arg("--user");
    let q = db.from("jobs").select("*").in("status", ["pending", "running"]).order("created_at");
    if (userId) q = q.eq("user_id", userId);
    const { data: jobs, error } = await q;
    if (error) die(error.message);
    out(await Promise.all((jobs ?? []).map(jobContext)));
  } else if (cmd === "claim") {
    const id = process.argv[3];
    if (!id) die("usage: claim <jobId>");
    const { data: job, error } = await db
      .from("jobs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !job) die(`No job ${id}`);
    const payload = job!.payload ?? {};
    if (payload.product_id && job!.type === "build_campaign") {
      await upsertCampaign(payload.product_id, {}, "building");
    }
    out(await jobContext(job));
  } else if (cmd === "add-product") {
    const userId = arg("--user");
    if (!userId) die("--user <uuid> is required");
    await upsertProduct(userId, readMeta(true));
  } else if (cmd === "save-campaign") {
    const productId = process.argv[3];
    if (!productId) die("usage: save-campaign <productId> --meta <file.json>");
    await upsertCampaign(productId, readMeta(true));
  } else if (cmd === "complete") {
    const id = process.argv[3];
    if (!id) die("usage: complete <jobId>");
    const { data: job } = await db.from("jobs").select("*").eq("id", id).maybeSingle();
    if (!job) die(`No job ${id}`);
    const payload = job!.payload ?? {};
    const meta = readMeta(false);

    if (job!.type === "build_campaign" && payload.product_id) {
      await upsertCampaign(payload.product_id, meta, "ready");
      await db
        .from("products")
        .update({
          status: "Promoting",
          ...(meta.drive_link ? { assets_link: meta.drive_link } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.product_id);
    }

    await db
      .from("jobs")
      .update({ status: "done", result: meta.result ?? "ok", updated_at: new Date().toISOString() })
      .eq("id", id);
    out({ ok: true, job_id: id });
  } else if (cmd === "fail") {
    const id = process.argv[3];
    if (!id) die("usage: fail <jobId> --message <why>");
    const message = arg("--message") ?? "unknown error";
    const { data: job } = await db.from("jobs").select("*").eq("id", id).maybeSingle();
    if (!job) die(`No job ${id}`);
    const payload = job!.payload ?? {};
    await db
      .from("jobs")
      .update({ status: "error", result: message, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (payload.product_id && job!.type === "build_campaign") {
      await db
        .from("campaigns")
        .update({ status: "error", notes: message, updated_at: new Date().toISOString() })
        .eq("product_id", payload.product_id);
    }
    out({ ok: true, job_id: id, failed: true });
  } else {
    die("Usage: npm run engine -- <pending|claim|add-product|save-campaign|complete|fail> [args]");
  }
}

main();
