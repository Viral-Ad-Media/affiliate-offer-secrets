import { db } from "./core";
import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { fallbackChain, resolveModel } from "@/lib/generationModels";
import { submitVideoWithFallback, pollVideo, downloadVideo } from "@/lib/generation/video";
import { uploadCampaignVideo } from "@/lib/supabase/storage";
import type { FbAdAngle, SocialPost } from "@/lib/shared";

// Per-item generalization of videogen.ts — same stage shape, but reads/writes one
// campaign_creatives row instead of a single campaigns column, seeded from that one angle's/
// post's own copy instead of the whole tiktok_md blob. Aspect ratio is picked from the row's own
// `source`: 16:9 for fb_ad_angle (Feed-ad-shaped), 9:16 for social_post (Reels/Stories-shaped) —
// matches the existing single-campaign generator's 9:16 default for that latter case.
export { GENERATE_CREATIVE_VIDEO_STAGES } from "@/lib/generationStages";
import { GENERATE_CREATIVE_VIDEO_STAGES } from "@/lib/generationStages";
export type GenerateCreativeVideoStage = (typeof GENERATE_CREATIVE_VIDEO_STAGES)[number];

export type GenerateCreativeVideoPayload = {
  campaign_creative_id: string;
  /**
   * Chosen model, resolved at QUEUE time from the per-generation override or the workspace
   * default. Optional: a job queued before models were selectable, or by any direct API caller,
   * carries none and resolves to the same default that was hardcoded before — so old jobs behave
   * exactly as they did.
   */
  model_id?: string | null;
};

export type CreativeVideoStageOutput = {
  stageData: Record<string, unknown>;
  creativePatch?: Record<string, unknown>;
  retry?: boolean;
};

// Same load-bearing ownership re-check as creativeimage.ts's stageVerify.
async function stageVerify(
  payload: GenerateCreativeVideoPayload,
  workspaceId: string
): Promise<CreativeVideoStageOutput> {
  const { data: creative } = await db
    .from("campaign_creatives")
    .select("id, campaign_id, source, item_index")
    .eq("id", payload.campaign_creative_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!creative) throw new Error("Creative not found for this account");

  const { data: campaign } = await db
    .from("campaigns")
    .select("product_id, fb_ad_angles, social_posts")
    .eq("id", creative.campaign_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign not found for this account");

  let toneText: string;
  if (creative.source === "fb_ad_angle") {
    const angles = (campaign.fb_ad_angles as FbAdAngle[] | null) ?? [];
    const angle = angles[creative.item_index];
    if (!angle) throw new Error(`No ad angle at index ${creative.item_index} — campaign may have been rebuilt`);
    toneText = `Headline: ${angle.headline}\nPrimary text: ${angle.primary_text}\nDescription: ${angle.description}`;
  } else {
    const posts = (campaign.social_posts as SocialPost[] | null) ?? [];
    const post = posts[creative.item_index];
    if (!post) throw new Error(`No social post at index ${creative.item_index} — campaign may have been rebuilt`);
    toneText = `Caption: ${post.caption}`;
  }

  return {
    stageData: {
      product_id: campaign.product_id,
      tone_text: toneText,
      campaign_id: creative.campaign_id,
      source: creative.source,
      item_index: creative.item_index,
      // Carried from the payload into stage_data because stageSubmit runs on a later invocation
      // and only ever sees stage_data.
      model_id: payload.model_id ?? null,
    },
  };
}

async function stageScript(
  stageData: Record<string, unknown>,
  usage: UsageContext
): Promise<CreativeVideoStageOutput> {
  const { data: product } = await db
    .from("products")
    .select("product_title, niche, description")
    .eq("id", stageData.product_id)
    .maybeSingle();
  if (!product) throw new Error("Product not found");

  const result = await completeJSON<{ video_prompt: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `Product: "${product.product_title}" (${product.niche})\n${product.description ?? ""}\n\nCopy for this specific creative, for tone reference:\n${stageData.tone_text}\n\nWrite a single, vivid, well-formed text prompt (for an AI video generation model, ~4-8 seconds of footage) describing a short-form video scene for this product, matching the tone of the copy above — the mechanism/hook angle, not a guaranteed-outcome promise. Describe visuals, setting, mood, and camera movement only. Do NOT describe any on-screen text, captions, subtitles, or written words — the video model cannot render text reliably. Never depict real people, celebrities, medical/before-after imagery, or a fabricated testimonial.`,
    schema: {
      type: "object",
      properties: { video_prompt: { type: "string" } },
      required: ["video_prompt"],
    },
    maxTokens: 500,
    usage,
  });

  return { stageData: { ...stageData, video_prompt: result.video_prompt } };
}

async function stageSubmit(stageData: Record<string, unknown>): Promise<CreativeVideoStageOutput> {
  const aspectRatio = stageData.source === "fb_ad_angle" ? "16:9" : "9:16";
  // Preferred model first (per-generation override, else the workspace default — both resolved at
  // queue time into the payload), then one model per OTHER provider. See fallbackChain.
  const chain = fallbackChain("video", stageData.model_id);
  const { ref, model, fellBackFrom, note } = await submitVideoWithFallback(chain, {
    prompt: stageData.video_prompt as string,
    aspectRatio,
  });
  return {
    stageData: {
      ...stageData,
      // The model that ACCEPTED the job, which is not necessarily the one that was asked for.
      // poll and download run on later invocations with only stage_data to go on, so recording
      // this is what stops them polling a provider that never issued the reference.
      model_id: model.id,
      operation_name: ref,
      fell_back_from: fellBackFrom?.id ?? null,
      fallback_note: note,
    },
  };
}

async function stagePoll(stageData: Record<string, unknown>): Promise<CreativeVideoStageOutput> {
  const model = resolveModel("video", stageData.model_id);
  const result = await pollVideo(model, stageData.operation_name as string);
  if (!result.done) return { stageData, retry: true };
  if (result.error || !result.url) {
    throw new Error(result.error ?? "Video generation finished without producing a video");
  }
  return { stageData: { ...stageData, video_uri: result.url } };
}

async function stageDownload(stageData: Record<string, unknown>): Promise<CreativeVideoStageOutput> {
  // Download immediately — Google's own docs say this URI shouldn't be treated as a durable
  // long-term reference, and kie.ai's result URLs are equally not ours to depend on. Persisted
  // into our own private Storage bucket, not stored as-is. Per-item path convention (not the
  // legacy flat `${campaignId}.mp4`) since multiple items share a campaign now.
  const bytes = await downloadVideo(resolveModel("video", stageData.model_id), stageData.video_uri as string);
  const path = `${stageData.campaign_id}/${stageData.source}-${stageData.item_index}.mp4`;
  await uploadCampaignVideo(path, bytes, "video/mp4");
  return { stageData: { ...stageData, video_path: path } };
}

async function stageFinalize(stageData: Record<string, unknown>): Promise<CreativeVideoStageOutput> {
  return {
    stageData,
    creativePatch: {
      video_path: stageData.video_path,
      status: "ready",
      error: null,
      // The model that actually produced it — not necessarily the one requested, if fallback ran.
      model: (stageData.model_id as string | null) ?? null,
    },
  };
}

export async function runGenerateCreativeVideoStage(
  stageIndex: number,
  payload: GenerateCreativeVideoPayload,
  userId: string,
  workspaceId: string,
  stageData: Record<string, unknown>,
  usageCtx: { userId: string; jobId: string }
): Promise<CreativeVideoStageOutput> {
  const stage = GENERATE_CREATIVE_VIDEO_STAGES[stageIndex];
  const usage: UsageContext = { ...usageCtx, jobType: "generate_creative_video", stage };
  switch (stage) {
    case "verify":
      return stageVerify(payload, workspaceId);
    case "script":
      return stageScript(stageData, usage);
    case "submit":
      return stageSubmit(stageData);
    case "poll":
      return stagePoll(stageData);
    case "download":
      return stageDownload(stageData);
    case "finalize":
      return stageFinalize(stageData);
    default:
      throw new Error(`Unknown generate_creative_video stage index ${stageIndex}`);
  }
}
