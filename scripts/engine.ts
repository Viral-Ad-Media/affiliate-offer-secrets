/**
 * Manual/debug engine CLI. Jobs now process automatically (see lib/engine/worker.ts, triggered
 * by a Supabase Postgres trigger + pg_cron backstop) — this CLI is a fallback for inspecting or
 * manually driving a stuck job, not the primary path.
 *
 *   npm run engine -- pending [--user <uuid>]       list pending/running jobs + context (JSON);
 *                                                    all tenants, or one with --user
 *   npm run engine -- claim <jobId>                 mark a job running, print its full context
 *   npm run engine -- add-product --user <uuid> --meta <p.json>
 *                                                    upsert one discovered product for a tenant
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
 * Upsert/dedupe logic lives in lib/engine/core.ts, shared with the automated worker.
 */
import fs from "fs";
import { db, upsertProduct, upsertCampaign, jobContext } from "../lib/engine/core";

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
      .update({
        status: "running",
        locked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
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
    try {
      const id = await upsertProduct(userId, readMeta(true));
      out({ ok: true, product_id: id });
    } catch (err: any) {
      die(err?.message ?? String(err));
    }
  } else if (cmd === "save-campaign") {
    const productId = process.argv[3];
    if (!productId) die("usage: save-campaign <productId> --meta <file.json>");
    try {
      const id = await upsertCampaign(productId, readMeta(true));
      out({ ok: true, campaign_id: id });
    } catch (err: any) {
      die(err?.message ?? String(err));
    }
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
