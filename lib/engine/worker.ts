import { db } from "./core";
import { runBuildCampaignStage, BUILD_CAMPAIGN_STAGES } from "./build";
import { runDiscoverProducts, type DiscoverJobPayload } from "./discover";
import { runLaunchAdStage, LAUNCH_AD_STAGES, type LaunchAdPayload } from "./adlaunch";

const INVOCATION_BUDGET_MS = 50_000; // stay safely under maxDuration=60 on any Vercel plan
const MAX_ATTEMPTS = 5;

type JobRow = {
  id: string;
  user_id: string;
  type: "discover_products" | "build_campaign" | "launch_ad";
  payload: any;
  status: string;
  stage: number;
  stage_data: Record<string, unknown>;
  attempts: number;
};

async function claimJob(): Promise<JobRow | null> {
  const { data, error } = await db.rpc("claim_job");
  if (error) {
    console.error("claim_job raw error:", JSON.stringify(error, null, 2));
    throw new Error(`claim_job failed: ${error.message}`);
  }
  return (data as JobRow) ?? null;
}

async function getNickname(userId: string): Promise<string> {
  const { data } = await db.from("profiles").select("nickname").eq("id", userId).maybeSingle();
  return data?.nickname ?? "YOURNICK";
}

async function markDone(jobId: string, result: string) {
  await db
    .from("jobs")
    .update({ status: "done", result, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function failJob(job: JobRow, message: string) {
  if (job.attempts >= MAX_ATTEMPTS) {
    await db
      .from("jobs")
      .update({ status: "error", result: message, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    if (job.type === "build_campaign" && job.payload?.product_id) {
      await db
        .from("campaigns")
        .update({ status: "error", notes: message, updated_at: new Date().toISOString() })
        .eq("user_id", job.user_id)
        .eq("product_id", job.payload.product_id);
    }
    if (job.type === "launch_ad" && job.payload?.campaign_id) {
      await db
        .from("ad_launches")
        .update({ status: "failed", notes: message, updated_at: new Date().toISOString() })
        .eq("campaign_id", job.payload.campaign_id);
    }
  } else {
    // Leave pending (not running) so the natural claim_job() path retries it.
    await db
      .from("jobs")
      .update({ status: "pending", result: message, updated_at: new Date().toISOString() })
      .eq("id", job.id);
  }
}

async function processDiscover(job: JobRow) {
  const nickname = await getNickname(job.user_id);
  const result = await runDiscoverProducts(
    job.user_id,
    job.id,
    nickname,
    job.payload as DiscoverJobPayload
  );
  await markDone(job.id, `${result.saved} products saved`);
}

// Returns { done: true } once the last stage finishes, { raced: true } if another worker
// already advanced this job (safe no-op), or { done: false } to keep looping.
async function processBuildCampaignStage(job: JobRow): Promise<{ done: boolean; raced?: boolean }> {
  const productId = job.payload?.product_id;
  if (!productId) throw new Error("build_campaign job missing payload.product_id");

  const { data: product } = await db.from("products").select("*").eq("id", productId).maybeSingle();
  if (!product) throw new Error(`No product ${productId}`);

  if (job.stage === 0) {
    await db
      .from("campaigns")
      .upsert(
        { user_id: job.user_id, product_id: productId, status: "building" },
        { onConflict: "user_id,product_id", ignoreDuplicates: true }
      );
  }

  const nickname = await getNickname(job.user_id);
  const { stageData, campaignPatch } = await runBuildCampaignStage(
    job.stage,
    product as any,
    nickname,
    job.stage_data ?? {},
    { userId: job.user_id, jobId: job.id }
  );

  if (campaignPatch && Object.keys(campaignPatch).length > 0) {
    await db
      .from("campaigns")
      .update({ ...campaignPatch, updated_at: new Date().toISOString() })
      .eq("user_id", job.user_id)
      .eq("product_id", productId);
  }

  const nextStage = job.stage + 1;
  const { data: advanced } = await db
    .from("jobs")
    .update({ stage: nextStage, stage_data: stageData, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("stage", job.stage)
    .select("id")
    .maybeSingle();

  if (!advanced) return { done: false, raced: true };

  if (nextStage >= BUILD_CAMPAIGN_STAGES.length) {
    await db
      .from("campaigns")
      .update({ status: "ready", updated_at: new Date().toISOString() })
      .eq("user_id", job.user_id)
      .eq("product_id", productId);
    await db
      .from("products")
      .update({ status: "Promoting", updated_at: new Date().toISOString() })
      .eq("id", productId);
    await markDone(job.id, "campaign ready");
    return { done: true };
  }

  return { done: false };
}

// Same optimistic-concurrency stage-advance shape as processBuildCampaignStage. The "verify"
// stage (index 0) is the real security boundary for this job type — see lib/engine/adlaunch.ts.
async function processLaunchAdStage(job: JobRow): Promise<{ done: boolean; raced?: boolean }> {
  const payload = job.payload as LaunchAdPayload;
  if (!payload?.campaign_id) throw new Error("launch_ad job missing payload.campaign_id");

  const { data: existingLaunch } = await db
    .from("ad_launches")
    .select("meta_campaign_id, meta_adset_id, meta_creative_id")
    .eq("campaign_id", payload.campaign_id)
    .maybeSingle();

  const { stageData, launchPatch } = await runLaunchAdStage(
    job.stage,
    payload,
    job.user_id,
    job.stage_data ?? {},
    {
      meta_campaign_id: existingLaunch?.meta_campaign_id ?? null,
      meta_adset_id: existingLaunch?.meta_adset_id ?? null,
      meta_creative_id: existingLaunch?.meta_creative_id ?? null,
    }
  );

  if (launchPatch && Object.keys(launchPatch).length > 0) {
    await db
      .from("ad_launches")
      .update({ ...launchPatch, updated_at: new Date().toISOString() })
      .eq("campaign_id", payload.campaign_id);
  }

  const nextStage = job.stage + 1;
  const { data: advanced } = await db
    .from("jobs")
    .update({ stage: nextStage, stage_data: stageData, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("stage", job.stage)
    .select("id")
    .maybeSingle();

  if (!advanced) return { done: false, raced: true };

  if (nextStage >= LAUNCH_AD_STAGES.length) {
    await markDone(job.id, "ad ready for review");
    return { done: true };
  }

  return { done: false };
}

export async function runWorkerLoop(): Promise<{ processed: number }> {
  const start = Date.now();
  let processed = 0;

  while (Date.now() - start < INVOCATION_BUDGET_MS) {
    const job = await claimJob();
    if (!job) break;

    try {
      if (job.type === "discover_products") {
        await processDiscover(job);
        processed++;
      } else if (job.type === "build_campaign") {
        let current: JobRow = job;
        while (Date.now() - start < INVOCATION_BUDGET_MS) {
          const result = await processBuildCampaignStage(current);
          processed++;
          if (result.done || result.raced) break;
          const { data: refreshed } = await db.from("jobs").select("*").eq("id", current.id).maybeSingle();
          if (!refreshed || refreshed.status !== "running") break;
          current = refreshed as JobRow;
        }
      } else if (job.type === "launch_ad") {
        let current: JobRow = job;
        while (Date.now() - start < INVOCATION_BUDGET_MS) {
          const result = await processLaunchAdStage(current);
          processed++;
          if (result.done || result.raced) break;
          const { data: refreshed } = await db.from("jobs").select("*").eq("id", current.id).maybeSingle();
          if (!refreshed || refreshed.status !== "running") break;
          current = refreshed as JobRow;
        }
      } else {
        await failJob(job, `Unknown job type: ${job.type}`);
      }
    } catch (err: any) {
      await failJob(job, err?.message ?? String(err));
    }
  }

  return { processed };
}
