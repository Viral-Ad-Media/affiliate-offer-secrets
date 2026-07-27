import { db } from "./core";
import { createAd, createAdCreative, createAdSet, createCampaign, uploadAdImage } from "@/lib/meta/client";
import { fetchImageAsDataUrl } from "./images";

export const LAUNCH_AD_STAGES = ["verify", "campaign", "adset", "creative", "ad"] as const;
export type LaunchAdStage = (typeof LAUNCH_AD_STAGES)[number];

export type LaunchAdPayload = {
  campaign_id: string;
  ad_account_id: string;
  page_id: string;
  destination: "presell" | "bridge";
  headline: string;
  primary_text: string;
  country: string;
  budget_credits: number;
};

export type AdLaunchStageOutput = {
  stageData: Record<string, unknown>;
  launchPatch?: Record<string, unknown>;
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
// ad_account_id) must be caught here, not just at the API route that queues the job. Runs once,
// as stage 0; later stages trust job.user_id because this stage already proved it.
async function stageVerify(payload: LaunchAdPayload, userId: string): Promise<AdLaunchStageOutput> {
  const { data: campaign } = await db
    .from("campaigns")
    .select("id, images_json, ad_creative_image_data_url")
    .eq("id", payload.campaign_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign not found for this account");

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

  await db.from("ad_launches").upsert(
    {
      user_id: userId,
      campaign_id: payload.campaign_id,
      ad_account_id: payload.ad_account_id,
      page_id: payload.page_id,
      destination: payload.destination,
      headline: payload.headline,
      primary_text: payload.primary_text,
      country: payload.country,
      budget_credits: payload.budget_credits,
      status: "building",
    },
    { onConflict: "campaign_id" }
  );

  const sourceImageUrl =
    (campaign.images_json as { source_images?: string[] } | null)?.source_images?.[0] ?? null;

  // Only the Vault secret_id (not a live secret itself) is persisted into stage_data — jobs has
  // a permissive RLS select policy for its own owner, so the raw token must never land there.
  // Each later stage re-fetches the actual token fresh via get_meta_secret().
  return {
    stageData: {
      user_token_secret_id: connection.user_token_secret_id,
      source_image_url: sourceImageUrl,
      ad_creative_image_data_url: campaign.ad_creative_image_data_url ?? null,
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

async function stageCreative(
  payload: LaunchAdPayload,
  stageData: Record<string, unknown>
): Promise<AdLaunchStageOutput> {
  const token = await getToken(stageData.user_token_secret_id as string);
  const sourceImageUrl = stageData.source_image_url as string | null;
  const adCreativeDataUrl = stageData.ad_creative_image_data_url as string | null;

  let imageHash: string | null = null;
  if (adCreativeDataUrl) {
    // Prefer the AI-generated ad creative when one exists — falls back to the vendor product
    // photo below, never a hard dependency on generation having run.
    imageHash = await uploadAdImage(payload.ad_account_id, token, adCreativeDataUrl);
  } else if (sourceImageUrl) {
    const dataUrl = await fetchImageAsDataUrl(sourceImageUrl);
    if (dataUrl) imageHash = await uploadAdImage(payload.ad_account_id, token, dataUrl);
  }
  if (!imageHash) throw new Error("No usable product image available for the ad creative");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  const linkUrl = `${appUrl}/p/${payload.campaign_id}/${payload.destination}`;

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
