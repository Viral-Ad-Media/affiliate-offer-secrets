import { db } from "./core";
import { runBuildCampaignStage, BUILD_CAMPAIGN_STAGES } from "./build";
import { runDiscoverProducts, type DiscoverJobPayload } from "./discover";
import { runLaunchAdStage, LAUNCH_AD_STAGES, type LaunchAdPayload } from "./adlaunch";
import { runGenerateAdImageStage, GENERATE_AD_IMAGE_STAGES, type GenerateAdImagePayload } from "./adimage";
import { runGenerateVideoStage, GENERATE_VIDEO_STAGES, type GenerateVideoPayload } from "./videogen";
import {
  runGenerateCreativeImageStage,
  GENERATE_CREATIVE_IMAGE_STAGES,
  type GenerateCreativeImagePayload,
} from "./creativeimage";
import { GENERATE_BLOG_IMAGE_STAGES, runGenerateBlogImageStage, type GenerateBlogImagePayload } from "./blogimage";
import {
  runGenerateCreativeVideoStage,
  GENERATE_CREATIVE_VIDEO_STAGES,
  type GenerateCreativeVideoPayload,
} from "./creativevideo";
import {
  runSendBroadcastEmailStage,
  SEND_BROADCAST_EMAIL_STAGES,
  type SendBroadcastEmailPayload,
} from "./broadcast";

const INVOCATION_BUDGET_MS = 50_000; // stay safely under maxDuration=60 on any Vercel plan
const MAX_ATTEMPTS = 5;

type JobRow = {
  id: string;
  user_id: string;
  type:
    | "discover_products"
    | "build_campaign"
    | "launch_ad"
    | "generate_ad_image"
    | "generate_video"
    | "generate_blog_image"
    | "generate_creative_image"
    | "generate_creative_video"
    | "send_broadcast_email";
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
    if (job.type === "launch_ad") {
      // Keyed by the launch's own id (threaded through stage_data by stageVerify), not
      // campaign_id — a campaign can have multiple launches now (one per angle), so campaign_id
      // alone would touch every launch under it. launch_id is only known once stage 0 has
      // committed; a failure during stage 0 itself has no row to update yet (no-op, correct — job
      // is still marked 'error' above regardless). A failure on a LATER stage within the same
      // invocation that claimed stage 0 could, in principle, miss this too (job is the pre-loop
      // object, not the loop's refreshed copy) — narrow, self-heals on the next claim/attempt.
      const launchId = (job.stage_data as any)?.launch_id as string | undefined;
      if (launchId) {
        await db
          .from("ad_launches")
          .update({ status: "failed", notes: message, updated_at: new Date().toISOString() })
          .eq("id", launchId);
      }
    }
    if (job.type === "generate_video" && job.payload?.campaign_id) {
      await db
        .from("campaigns")
        .update({ video_status: "failed", video_error: message, updated_at: new Date().toISOString() })
        .eq("id", job.payload.campaign_id);
    }
    // Unlike generate_ad_image (which has no analogous failure signal — a known, documented gap
    // left as-is on that legacy job type), the per-item creative jobs always write a real status
    // so the UI can show "failed" instead of silently staying "generating" forever.
    if (
      (job.type === "generate_creative_image" || job.type === "generate_creative_video") &&
      job.payload?.campaign_creative_id
    ) {
      await db
        .from("campaign_creatives")
        .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", job.payload.campaign_creative_id);
    }
    if (job.type === "generate_blog_image" && job.payload?.post_id) {
      await db
        .from("blog_posts")
        .update({ featured_image_status: "failed", featured_image_error: message, updated_at: new Date().toISOString() })
        .eq("id", job.payload.post_id);
    }
    if (job.type === "send_broadcast_email" && job.payload?.enrollment_step_id) {
      await db
        .from("broadcast_enrollment_steps")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", job.payload.enrollment_step_id);
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
// Past stage 0, every lookup/write is keyed by the launch's own id (threaded through stage_data by
// stageVerify), not campaign_id — a campaign can now have multiple launches, one per angle.
async function processLaunchAdStage(job: JobRow): Promise<StageResult> {
  const payload = job.payload as LaunchAdPayload;
  if (!payload?.campaign_id) throw new Error("launch_ad job missing payload.campaign_id");

  const launchId = (job.stage_data as any)?.launch_id as string | undefined;
  const { data: existingLaunch } = launchId
    ? await db
        .from("ad_launches")
        .select("meta_campaign_id, meta_adset_id, meta_creative_id")
        .eq("id", launchId)
        .maybeSingle()
    : { data: null };

  const { stageData, launchPatch, retry } = await runLaunchAdStage(
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

  const currentLaunchId = (stageData as any)?.launch_id as string | undefined;
  if (launchPatch && Object.keys(launchPatch).length > 0 && currentLaunchId) {
    await db
      .from("ad_launches")
      .update({ ...launchPatch, updated_at: new Date().toISOString() })
      .eq("id", currentLaunchId);
  }

  // Unlike the other retry-capable job types (whose stageData is stable across retries — a poll
  // stage just re-checks the same operation_name/task_id), this stage's stageData can gain real
  // progress between retries (meta_video_id, once the upload completes) that must survive to the
  // next poll — so, uniquely here, persist stage_data even when not advancing the stage.
  if (retry) {
    await db.from("jobs").update({ stage_data: stageData, updated_at: new Date().toISOString() }).eq("id", job.id);
    return { done: false, retry: true };
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

// Per-item generalization of processGenerateAdImageStage — same shape, but every write targets
// campaign_creatives by id (payload.campaign_creative_id), not campaigns by campaign_id, since
// multiple rows now share one campaign.
async function processGenerateCreativeImageStage(job: JobRow): Promise<StageResult> {
  const payload = job.payload as GenerateCreativeImagePayload;
  if (!payload?.campaign_creative_id) {
    throw new Error("generate_creative_image job missing payload.campaign_creative_id");
  }

  const { stageData, creativePatch, retry } = await runGenerateCreativeImageStage(
    job.stage,
    payload,
    job.user_id,
    job.stage_data ?? {},
    { userId: job.user_id, jobId: job.id }
  );

  if (retry) return { done: false, retry: true };

  if (creativePatch && Object.keys(creativePatch).length > 0) {
    await db
      .from("campaign_creatives")
      .update({ ...creativePatch, updated_at: new Date().toISOString() })
      .eq("id", payload.campaign_creative_id);
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

  if (nextStage >= GENERATE_CREATIVE_IMAGE_STAGES.length) {
    await markDone(job.id, "creative image ready");
    return { done: true };
  }

  return { done: false };
}

// Blog featured image — same shape again, writing to blog_posts by payload.post_id.
async function processGenerateBlogImageStage(job: JobRow): Promise<StageResult> {
  const payload = job.payload as GenerateBlogImagePayload;
  if (!payload?.post_id) throw new Error("generate_blog_image job missing payload.post_id");

  const { stageData, postPatch, retry } = await runGenerateBlogImageStage(
    job.stage,
    payload,
    job.user_id,
    job.stage_data ?? {},
    { userId: job.user_id, jobId: job.id }
  );

  if (retry) return { done: false, retry: true };

  if (postPatch && Object.keys(postPatch).length > 0) {
    await db
      .from("blog_posts")
      .update({ ...postPatch, updated_at: new Date().toISOString() })
      .eq("id", payload.post_id);
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

  if (nextStage >= GENERATE_BLOG_IMAGE_STAGES.length) {
    await markDone(job.id, "blog featured image ready");
    return { done: true };
  }

  return { done: false };
}

// Per-item generalization of processGenerateVideoStage — same shape, targets campaign_creatives
// by id. The atomic per-row 'generating' claim happens up front in
// app/api/campaign-creatives/generate/route.ts (claim_campaign_creative RPC), same idiom as
// generate-video/route.ts's campaign-level UPDATE...WHERE...RETURNING claim.
async function processGenerateCreativeVideoStage(job: JobRow): Promise<StageResult> {
  const payload = job.payload as GenerateCreativeVideoPayload;
  if (!payload?.campaign_creative_id) {
    throw new Error("generate_creative_video job missing payload.campaign_creative_id");
  }

  const { stageData, creativePatch, retry } = await runGenerateCreativeVideoStage(
    job.stage,
    payload,
    job.user_id,
    job.stage_data ?? {},
    { userId: job.user_id, jobId: job.id }
  );

  if (retry) return { done: false, retry: true };

  if (creativePatch && Object.keys(creativePatch).length > 0) {
    await db
      .from("campaign_creatives")
      .update({ ...creativePatch, updated_at: new Date().toISOString() })
      .eq("id", payload.campaign_creative_id);
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

  if (nextStage >= GENERATE_CREATIVE_VIDEO_STAGES.length) {
    await markDone(job.id, "creative video ready");
    return { done: true };
  }

  return { done: false };
}

// Same optimistic-concurrency stage-advance shape as the other multi-stage job types, plus one
// narrow addition: a `skip: true` result (contact unsubscribed between queueing and this job
// running — see lib/engine/broadcast.ts's stageVerify) applies its patch and marks the job done
// without ever advancing to the "send" stage, rather than a generic new mechanic.
async function processSendBroadcastEmailStage(job: JobRow): Promise<StageResult> {
  const payload = job.payload as SendBroadcastEmailPayload;
  if (!payload?.enrollment_step_id) {
    throw new Error("send_broadcast_email job missing payload.enrollment_step_id");
  }

  const { stageData, enrollmentStepPatch, retry, skip } = await runSendBroadcastEmailStage(
    job.stage,
    payload,
    job.user_id,
    job.stage_data ?? {}
  );

  if (retry) return { done: false, retry: true };

  if (enrollmentStepPatch && Object.keys(enrollmentStepPatch).length > 0) {
    await db
      .from("broadcast_enrollment_steps")
      .update({ ...enrollmentStepPatch, updated_at: new Date().toISOString() })
      .eq("id", payload.enrollment_step_id);
  }

  if (skip) {
    await markDone(job.id, "skipped (unsubscribed)");
    return { done: true };
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

  if (nextStage >= SEND_BROADCAST_EMAIL_STAGES.length) {
    await markDone(job.id, "sent");
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
      } else if (job.type === "generate_creative_image") {
        processed += await runStageLoop(job, processGenerateCreativeImageStage, start);
      } else if (job.type === "generate_blog_image") {
        processed += await runStageLoop(job, processGenerateBlogImageStage, start);
      } else if (job.type === "generate_creative_video") {
        processed += await runStageLoop(job, processGenerateCreativeVideoStage, start);
      } else if (job.type === "send_broadcast_email") {
        processed += await runStageLoop(job, processSendBroadcastEmailStage, start);
      } else {
        await failJob(job, `Unknown job type: ${job.type}`);
      }
    } catch (err: any) {
      await failJob(job, err?.message ?? String(err));
    }
  }

  return { processed };
}
