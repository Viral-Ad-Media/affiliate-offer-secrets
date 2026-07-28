import { db } from "./core";
import { runBuildCampaignStage, BUILD_CAMPAIGN_STAGES } from "./build";
import { runDiscoverProducts, type DiscoverJobPayload } from "./discover";
import { runLaunchAdStage, LAUNCH_AD_STAGES, type LaunchAdPayload } from "./adlaunch";
import { runGenerateAdImageStage, GENERATE_AD_IMAGE_STAGES, type GenerateAdImagePayload } from "./adimage";
import { runGenerateVideoStage, GENERATE_VIDEO_STAGES, type GenerateVideoPayload } from "./videogen";

const INVOCATION_BUDGET_MS = 50_000; // stay safely under maxDuration=60 on any Vercel plan
const MAX_ATTEMPTS = 5;

type JobRow = {
  id: string;
  user_id: string;
  type: "discover_products" | "build_campaign" | "launch_ad" | "generate_ad_image" | "generate_video";
  payload: any;
  status: string;
  stage: number;
  stage_data: Record<string, unknown>;
  attempts: number;
};

// `retry: true` means "not ready yet, don't advance" — distinct from a normal stage-advance
// (`done: false`, falls through to re-fetch and continue) and from a raced advance (`raced:
// true`, another worker already moved this job on). See heartbeatRetry() for why this needs its
// own DB-level handling, not just "do nothing this invocation".
type StageResult = { done: boolean; raced?: boolean; retry?: boolean };

// Design-review fix: a poll stage that isn't ready yet must not let claim_job()'s own
// staleness-reclaim mechanics count against MAX_ATTEMPTS — refreshes locked_at (so the job
// isn't reclaimed as stale mid-wait) and cancels out the attempts increment claim_job() just
// made for this claim, so a legitimately-still-waiting job never nets progress toward the
// failure cap purely from waiting. Only genuine thrown errors still count via failJob().
async function heartbeatRetry(jobId: string) {
  await db.rpc("heartbeat_job_retry", { p_job_id: jobId });
}

// Shared stage-loop runner for every multi-stage job type. On `retry`, heartbeats and BREAKS
// (yields to the outer claim loop) rather than hammering the same not-ready poll — without this,
// a job whose poll always returns not-ready would monopolize the whole invocation budget
// re-polling itself, starving every other tenant's queued jobs for that entire invocation.
async function runStageLoop(
  initialJob: JobRow,
  processStage: (job: JobRow) => Promise<StageResult>,
  start: number
): Promise<number> {
  let current: JobRow = initialJob;
  let count = 0;
  while (Date.now() - start < INVOCATION_BUDGET_MS) {
    const result = await processStage(current);
    count++;
    if (result.retry) {
      await heartbeatRetry(current.id);
      break;
    }
    if (result.done || result.raced) break;
    const { data: refreshed } = await db.from("jobs").select("*").eq("id", current.id).maybeSingle();
    if (!refreshed || refreshed.status !== "running") break;
    current = refreshed as JobRow;
  }
  return count;
}

async function claimJob(): Promise<JobRow | null> {
  const { data, error } = await db.rpc("claim_job");
  if (error) {
    console.error("claim_job raw error:", JSON.stringify(error, null, 2));
    throw new Error(`claim_job failed: ${error.message}`);
  }
  return (data as JobRow) ?? null;
}

const KNOWN_NETWORKS = ["clickbank", "digistore24"] as const;

// Reads the caller's self-service network_connections row (see 0015_network_generalization.sql —
// not a secret, plain owner-scoped RLS, no Vault). Throws rather than falling back to a
// placeholder like the old getNickname()'s "YOURNICK" did — that was tolerable when nickname was
// rare-to-be-unset admin-only data; it isn't once it's self-service and commonly unset at first
// login, where a silent placeholder would ship broken/misleading hoplinks to real ad traffic. The
// API routes (app/api/jobs/route.ts, app/api/promote/route.ts) check this same condition before
// ever inserting the job — this is the worker-side belt-and-suspenders re-check, same trust-
// boundary split used for every other job type in this codebase.
async function getAffiliateId(userId: string, network: string): Promise<string> {
  const { data } = await db
    .from("network_connections")
    .select("affiliate_id")
    .eq("user_id", userId)
    .eq("network", network)
    .maybeSingle();
  if (!data?.affiliate_id) {
    throw new Error(`No ${network} connection found — connect your ${network} affiliate ID first.`);
  }
  return data.affiliate_id;
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
    if (job.type === "generate_video" && job.payload?.campaign_id) {
      await db
        .from("campaigns")
        .update({ video_status: "failed", video_error: message, updated_at: new Date().toISOString() })
        .eq("id", job.payload.campaign_id);
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
  // network isn't a cross-tenant reference (unlike campaign_id/page_id/ad_account_id elsewhere in
  // this file) — it's an enum selecting behavior for the calling tenant's own job, and jobs' RLS
  // already guarantees job.user_id is the inserting user's own auth.uid(). What still needs
  // checking: the value is one this function actually supports, and the tenant is entitled to use
  // it (has a real network_connections row) — the practical analogue of the ownership-reverify
  // pattern used for foreign-key-shaped payload fields elsewhere.
  const network = ((job.payload as any)?.network as string) || "clickbank";
  if (!KNOWN_NETWORKS.includes(network as any)) {
    throw new Error(`Unknown network: ${network}`);
  }
  if (network !== "clickbank") {
    throw new Error(`Automated discovery for ${network} isn't available yet.`);
  }
  const affiliateId = await getAffiliateId(job.user_id, network);
  const result = await runDiscoverProducts(
    job.user_id,
    job.id,
    network as "clickbank",
    affiliateId,
    job.payload as DiscoverJobPayload
  );
  await markDone(job.id, `${result.saved} products saved`);
}

// Returns { done: true } once the last stage finishes, { raced: true } if another worker
// already advanced this job (safe no-op), or { done: false } to keep looping.
async function processBuildCampaignStage(job: JobRow): Promise<StageResult> {
  const productId = job.payload?.product_id;
  if (!productId) throw new Error("build_campaign job missing payload.product_id");

  // Bundled fix, pre-existing and unrelated to this change's origin: this SELECT had no user_id
  // filter, so a forged payload.product_id could let one tenant's build_campaign job read (and
  // spend that tenant's own Anthropic usage building a full content kit from) another tenant's
  // private product row — a content-disclosure gap. Scoping to job.user_id closes it the same way
  // every other job type in this codebase re-verifies ownership of payload-referenced resources.
  const { data: product } = await db
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("user_id", job.user_id)
    .maybeSingle();
  if (!product) throw new Error(`No product ${productId}`);

  if (job.stage === 0) {
    await db
      .from("campaigns")
      .upsert(
        { user_id: job.user_id, product_id: productId, status: "building" },
        { onConflict: "user_id,product_id", ignoreDuplicates: true }
      );
  }

  // Needed so the bridge page's lead-capture form can embed the real campaign id (see
  // renderBridgeHtml's campaignId param) — this function never held the campaign's own id before,
  // only ever addressing the row by (user_id, product_id).
  const { data: campaignRow } = await db
    .from("campaigns")
    .select("id")
    .eq("user_id", job.user_id)
    .eq("product_id", productId)
    .maybeSingle();
  if (!campaignRow) throw new Error(`No campaign row for product ${productId}`);

  const affiliateId = await getAffiliateId(job.user_id, product.network);
  const { stageData, campaignPatch } = await runBuildCampaignStage(
    job.stage,
    product as any,
    affiliateId,
    job.stage_data ?? {},
    { userId: job.user_id, jobId: job.id },
    campaignRow.id
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
async function processLaunchAdStage(job: JobRow): Promise<StageResult> {
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

// Same optimistic-concurrency stage-advance shape as the other multi-stage job types. The
// "verify" stage (index 0) is the real security boundary — see lib/engine/adimage.ts.
async function processGenerateAdImageStage(job: JobRow): Promise<StageResult> {
  const payload = job.payload as GenerateAdImagePayload;
  if (!payload?.campaign_id) throw new Error("generate_ad_image job missing payload.campaign_id");

  const { stageData, campaignPatch, retry } = await runGenerateAdImageStage(
    job.stage,
    payload,
    job.user_id,
    job.stage_data ?? {},
    { userId: job.user_id, jobId: job.id }
  );

  if (retry) return { done: false, retry: true };

  if (campaignPatch && Object.keys(campaignPatch).length > 0) {
    await db
      .from("campaigns")
      .update({ ...campaignPatch, updated_at: new Date().toISOString() })
      .eq("id", payload.campaign_id);
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

  if (nextStage >= GENERATE_AD_IMAGE_STAGES.length) {
    await markDone(job.id, "ad creative ready");
    return { done: true };
  }

  return { done: false };
}

// Same shape again. video_status is set to 'generating' by the API route that queues this job
// (before insert, closing the concurrent-duplicate race — see app/api/campaigns/[id]/
// generate-video/route.ts); this function only ever moves it to 'ready' (finalize stage,
// via campaignPatch) or 'failed' (failJob, on terminal error).
async function processGenerateVideoStage(job: JobRow): Promise<StageResult> {
  const payload = job.payload as GenerateVideoPayload;
  if (!payload?.campaign_id) throw new Error("generate_video job missing payload.campaign_id");

  const { stageData, campaignPatch, retry } = await runGenerateVideoStage(
    job.stage,
    payload,
    job.user_id,
    job.stage_data ?? {},
    { userId: job.user_id, jobId: job.id }
  );

  if (retry) return { done: false, retry: true };

  if (campaignPatch && Object.keys(campaignPatch).length > 0) {
    await db
      .from("campaigns")
      .update({ ...campaignPatch, updated_at: new Date().toISOString() })
      .eq("id", payload.campaign_id);
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

  if (nextStage >= GENERATE_VIDEO_STAGES.length) {
    await markDone(job.id, "video ready");
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
        processed += await runStageLoop(job, processBuildCampaignStage, start);
      } else if (job.type === "launch_ad") {
        processed += await runStageLoop(job, processLaunchAdStage, start);
      } else if (job.type === "generate_ad_image") {
        processed += await runStageLoop(job, processGenerateAdImageStage, start);
      } else if (job.type === "generate_video") {
        processed += await runStageLoop(job, processGenerateVideoStage, start);
      } else {
        await failJob(job, `Unknown job type: ${job.type}`);
      }
    } catch (err: any) {
      await failJob(job, err?.message ?? String(err));
    }
  }

  return { processed };
}
