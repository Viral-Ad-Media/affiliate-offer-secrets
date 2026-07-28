import { db } from "./core";
import {
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  createVideoAdCreative,
  getVideoStatus,
  uploadAdImage,
  uploadAdVideo,
} from "@/lib/meta/client";
import { fetchImageAsDataUrl } from "./images";
import { downloadCampaignVideo } from "@/lib/supabase/storage";
import type { FbAdAngle } from "@/lib/shared";

export const LAUNCH_AD_STAGES = ["verify", "campaign", "adset", "creative", "ad"] as const;
export type LaunchAdStage = (typeof LAUNCH_AD_STAGES)[number];

export type LaunchAdPayload = {
  campaign_id: string;
  ad_account_id: string;
  page_id: string;
  angle_index: number;
  creative_kind: "image" | "video";
  headline: string;
  primary_text: string;
  country: string;
  budget_credits: number;
};

export type AdLaunchStageOutput = {
  stageData: Record<string, unknown>;
  launchPatch?: Record<string, unknown>;
  retry?: boolean;
};

type ExistingLaunch = {
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_creative_id: string | null;
};

async function getToken(secretId: string): Promise<string> {
  const { data, error } = await db.rpc("get_meta_secret", { p_secret_id: secretId });
  if (error || !data) throw new Error("Could not retrieve Meta access token");
  return data as string;
}

// The real security boundary for this whole job type — jobs' own RLS only validates the row's
// user_id, not payload contents, so a forged payload (another tenant's campaign_id/page_id/
// ad_account_id/angle_index) must be caught here, not just at the API route that queues the job.
// Runs once, as stage 0; later stages trust job.user_id because this stage already proved it.
async function stageVerify(payload: LaunchAdPayload, userId: string): Promise<AdLaunchStageOutput> {
  const { data: campaign } = await db
    .from("campaigns")
    .select("id, images_json, ad_creative_image_data_url, fb_ad_angles")
    .eq("id", payload.campaign_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign not found for this account");

  const angles = (campaign.fb_ad_angles as FbAdAngle[] | null) ?? [];
  if (!angles[payload.angle_index]) {
    throw new Error(`No ad angle at index ${payload.angle_index} — campaign may have been rebuilt`);
  }

  // The launch can't proceed on a creative that isn't finished generating — re-checked here (the
  // route's own check is a UX nicety), since this stage is the real boundary.
  const { data: requestedCreative } = await db
    .from("campaign_creatives")
    .select("status, image_data_url, video_path")
    .eq("campaign_id", payload.campaign_id)
    .eq("source", "fb_ad_angle")
    .eq("item_index", payload.angle_index)
    .eq("kind", payload.creative_kind)
    .eq("user_id", userId)
    .maybeSingle();
  if (!requestedCreative || requestedCreative.status !== "ready") {
    throw new Error(`The ${payload.creative_kind} creative for this angle isn't ready yet`);
  }

  // A video ad still needs a thumbnail — prefer this same angle's own generated image if one is
  // ready, falling back further (in stageCreative) to the campaign-level/vendor-photo chain, never
  // a hard dependency on the image variant having been generated too.
  let thumbnailImageDataUrl: string | null = null;
  if (payload.creative_kind === "video") {
    const { data: siblingImage } = await db
      .from("campaign_creatives")
      .select("status, image_data_url")
      .eq("campaign_id", payload.campaign_id)
      .eq("source", "fb_ad_angle")
      .eq("item_index", payload.angle_index)
      .eq("kind", "image")
      .eq("user_id", userId)
      .maybeSingle();
    if (siblingImage?.status === "ready") thumbnailImageDataUrl = siblingImage.image_data_url ?? null;
  }

  const { data: page } = await db
    .from("meta_pages")
    .select("page_id")
    .eq("page_id", payload.page_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!page) throw new Error("Page not found for this account");

  const { data: adAccount } = await db
    .from("meta_ad_accounts")
    .select("ad_account_id")
    .eq("ad_account_id", payload.ad_account_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!adAccount) throw new Error("Ad account not found for this account");

  const { data: connection } = await db
    .from("meta_connections")
    .select("user_token_secret_id, ads_management_granted")
    .eq("user_id", userId)
    .maybeSingle();
  if (!connection) throw new Error("No Meta connection for this account");
  if (!connection.ads_management_granted) {
    throw new Error("Ad permissions not granted — reconnect Facebook to enable ad launches");
  }

  // Business-key upsert (find-or-create by campaign_id+angle_index) — the only place this job
  // type needs one, since every later stage keys off the returned id, threaded forward via
  // stageData.launch_id (see 0020_multi_angle_ad_launches.sql for why id, not the business key,
  // is what the rest of this pipeline uses).
  const { data: launchRow } = await db
    .from("ad_launches")
    .upsert(
      {
        user_id: userId,
        campaign_id: payload.campaign_id,
        ad_account_id: payload.ad_account_id,
        page_id: payload.page_id,
        angle_index: payload.angle_index,
        creative_kind: payload.creative_kind,
        // Always "bridge" — the presell page variant was merged into it (lib/engine/renderPages.ts).
        // Not exposed as caller input anymore; the column itself stays for now (see build.ts's
        // comment on campaigns.presell_html for why this codebase leaves deprecated columns as-is).
        destination: "bridge",
        headline: payload.headline,
        primary_text: payload.primary_text,
        country: payload.country,
        budget_credits: payload.budget_credits,
        status: "building",
      },
      { onConflict: "campaign_id,angle_index" }
    )
    .select("id")
    .single();
  if (!launchRow) throw new Error("Failed to create ad_launches row");

  const sourceImageUrl =
    (campaign.images_json as { source_images?: string[] } | null)?.source_images?.[0] ?? null;

  // Only the Vault secret_id (not a live secret itself) is persisted into stage_data — jobs has
  // a permissive RLS select policy for its own owner, so the raw token must never land there.
  // Each later stage re-fetches the actual token fresh via get_meta_secret().
  return {
    stageData: {
      launch_id: launchRow.id,
      user_token_secret_id: connection.user_token_secret_id,
      source_image_url: sourceImageUrl,
      ad_creative_image_data_url: campaign.ad_creative_image_data_url ?? null,
      creative_image_data_url:
        payload.creative_kind === "image" ? (requestedCreative.image_data_url ?? null) : thumbnailImageDataUrl,
      creative_video_path: payload.creative_kind === "video" ? (requestedCreative.video_path ?? null) : null,
    },
  };
}

async function stageCampaign(
  payload: LaunchAdPayload,
  stageData: Record<string, unknown>
): Promise<AdLaunchStageOutput> {
  const token = await getToken(stageData.user_token_secret_id as string);
  const result = await createCampaign(payload.ad_account_id, token, {
    name: `CBS - ${payload.headline}`.slice(0, 100),
    dailyBudgetCents: payload.budget_credits * 100,
  });
  return { stageData, launchPatch: { meta_campaign_id: result.id } };
}

async function stageAdSet(
  payload: LaunchAdPayload,
  stageData: Record<string, unknown>,
  launch: ExistingLaunch
): Promise<AdLaunchStageOutput> {
  if (!launch.meta_campaign_id) throw new Error("Missing meta_campaign_id for adset stage");
  const token = await getToken(stageData.user_token_secret_id as string);
  const result = await createAdSet(payload.ad_account_id, token, {
    name: `CBS - ${payload.headline}`.slice(0, 100),
    campaignId: launch.meta_campaign_id,
    country: payload.country,
  });
  return { stageData, launchPatch: { meta_adset_id: result.id } };
}

// Same resolution chain for both image and video-thumbnail use: this angle's own generated image
// first, then the campaign-level fallback, then the vendor product photo — never a hard
// dependency on any one of them having been generated.
async function resolveImageHash(
  adAccountId: string,
  token: string,
  stageData: Record<string, unknown>
): Promise<string> {
  const angleImage = stageData.creative_image_data_url as string | null;
  const adCreativeDataUrl = stageData.ad_creative_image_data_url as string | null;
  const sourceImageUrl = stageData.source_image_url as string | null;

  if (angleImage) return uploadAdImage(adAccountId, token, angleImage);
  if (adCreativeDataUrl) return uploadAdImage(adAccountId, token, adCreativeDataUrl);
  if (sourceImageUrl) {
    const dataUrl = await fetchImageAsDataUrl(sourceImageUrl);
    if (dataUrl) return uploadAdImage(adAccountId, token, dataUrl);
  }
  throw new Error("No usable image available for the ad creative");
}

async function stageCreativeImage(
  payload: LaunchAdPayload,
  stageData: Record<string, unknown>
): Promise<AdLaunchStageOutput> {
  const token = await getToken(stageData.user_token_secret_id as string);
  const imageHash = await resolveImageHash(payload.ad_account_id, token, stageData);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  const linkUrl = `${appUrl}/p/${payload.campaign_id}/bridge`;

  const result = await createAdCreative(payload.ad_account_id, token, {
    name: `CBS - ${payload.headline}`.slice(0, 100),
    pageId: payload.page_id,
    imageHash,
    linkUrl,
    message: payload.primary_text,
    headline: payload.headline,
  });
  return { stageData, launchPatch: { meta_creative_id: result.id } };
}

// Genuinely multi-step and async (upload, then wait for Meta's own transcoding, then create the
// creative) — this is NOT a new pattern for this codebase: it fits the existing `retry: true`
// heartbeat mechanic exactly, since that mechanic is generic to any stage returning it, not
// specifically named-"poll" stages. First entry (no stageData.meta_video_id yet) uploads and
// stores the returned id; every entry (including the first, once the id exists) checks processing
// status — not-ready yields retry: true, which heartbeats and yields to other tenants' jobs
// exactly like generate_creative_video's own poll stage does. Once ready, resolves the thumbnail
// and creates the video ad creative.
async function stageCreativeVideo(
  payload: LaunchAdPayload,
  stageData: Record<string, unknown>
): Promise<AdLaunchStageOutput> {
  const token = await getToken(stageData.user_token_secret_id as string);

  let metaVideoId = stageData.meta_video_id as string | undefined;
  if (!metaVideoId) {
    const videoPath = stageData.creative_video_path as string | null;
    if (!videoPath) throw new Error("No video available for this angle's creative");
    const bytes = await downloadCampaignVideo(videoPath);
    metaVideoId = await uploadAdVideo(payload.ad_account_id, token, bytes);
  }

  const status = await getVideoStatus(metaVideoId, token);
  if (status.video_status === "error") throw new Error("Meta failed to process the uploaded video");
  if (status.video_status !== "ready") {
    return { stageData: { ...stageData, meta_video_id: metaVideoId }, retry: true };
  }

  const imageHash = await resolveImageHash(payload.ad_account_id, token, stageData);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  const linkUrl = `${appUrl}/p/${payload.campaign_id}/bridge`;

  const result = await createVideoAdCreative(payload.ad_account_id, token, {
    name: `CBS - ${payload.headline}`.slice(0, 100),
    pageId: payload.page_id,
    videoId: metaVideoId,
    imageHash,
    linkUrl,
    message: payload.primary_text,
    headline: payload.headline,
  });
  return { stageData, launchPatch: { meta_creative_id: result.id, meta_video_id: metaVideoId } };
}

async function stageCreative(
  payload: LaunchAdPayload,
  stageData: Record<string, unknown>
): Promise<AdLaunchStageOutput> {
  return payload.creative_kind === "video"
    ? stageCreativeVideo(payload, stageData)
    : stageCreativeImage(payload, stageData);
}

async function stageAd(
  payload: LaunchAdPayload,
  stageData: Record<string, unknown>,
  launch: ExistingLaunch
): Promise<AdLaunchStageOutput> {
  if (!launch.meta_adset_id || !launch.meta_creative_id) {
    throw new Error("Missing meta_adset_id/meta_creative_id for ad stage");
  }
  const token = await getToken(stageData.user_token_secret_id as string);
  const result = await createAd(payload.ad_account_id, token, {
    name: `CBS - ${payload.headline}`.slice(0, 100),
    adsetId: launch.meta_adset_id,
    creativeId: launch.meta_creative_id,
  });
  return { stageData, launchPatch: { meta_ad_id: result.id, status: "paused_review" } };
}

export async function runLaunchAdStage(
  stageIndex: number,
  payload: LaunchAdPayload,
  userId: string,
  stageData: Record<string, unknown>,
  existingLaunch: ExistingLaunch
): Promise<AdLaunchStageOutput> {
  const stage = LAUNCH_AD_STAGES[stageIndex];
  switch (stage) {
    case "verify":
      return stageVerify(payload, userId);
    case "campaign":
      return stageCampaign(payload, stageData);
    case "adset":
      return stageAdSet(payload, stageData, existingLaunch);
    case "creative":
      return stageCreative(payload, stageData);
    case "ad":
      return stageAd(payload, stageData, existingLaunch);
    default:
      throw new Error(`Unknown launch_ad stage index ${stageIndex}`);
  }
}
