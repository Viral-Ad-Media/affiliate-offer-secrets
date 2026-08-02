import { db } from "./core";
import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { startVeoGeneration, getVeoOperation, downloadVeoVideo } from "@/lib/gemini/client";
import { uploadCampaignVideo } from "@/lib/supabase/storage";

export const GENERATE_VIDEO_STAGES = [
  "verify",
  "script",
  "submit",
  "poll",
  "download",
  "finalize",
] as const;
export type GenerateVideoStage = (typeof GENERATE_VIDEO_STAGES)[number];

export type GenerateVideoPayload = {
  campaign_id: string;
};

export type VideoStageOutput = {
  stageData: Record<string, unknown>;
  campaignPatch?: Record<string, unknown>;
  retry?: boolean;
};

// Same load-bearing ownership re-check as adlaunch.ts/adimage.ts's stageVerify — jobs' RLS only
// validates the row's user_id, not payload contents.
async function stageVerify(
  payload: GenerateVideoPayload,
  workspaceId: string
): Promise<VideoStageOutput> {
  const { data: campaign } = await db
    .from("campaigns")
    .select("id, product_id, tiktok_md")
    .eq("id", payload.campaign_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign not found for this account");

  return {
    stageData: { product_id: campaign.product_id, tiktok_md: campaign.tiktok_md ?? "" },
  };
}

async function stageScript(
  stageData: Record<string, unknown>,
  usage: UsageContext
): Promise<VideoStageOutput> {
  const { data: product } = await db
    .from("products")
    .select("product_title, niche, description")
    .eq("id", stageData.product_id)
    .maybeSingle();
  if (!product) throw new Error("Product not found");

  const result = await completeJSON<{ video_prompt: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `Product: "${product.product_title}" (${product.niche})\n${product.description ?? ""}\n\nExisting TikTok hooks/scripts for tone reference:\n${(stageData.tiktok_md as string).slice(0, 3000)}\n\nWrite a single, vivid, well-formed text prompt (for an AI video generation model, ~4-8 seconds of footage) describing a short-form vertical video scene for this product — the mechanism/hook angle, not a guaranteed-outcome promise. Describe visuals, setting, mood, and camera movement only. Do NOT describe any on-screen text, captions, subtitles, or written words — the video model cannot render text reliably. Never depict real people, celebrities, medical/before-after imagery, or a fabricated testimonial.`,
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

async function stageSubmit(stageData: Record<string, unknown>): Promise<VideoStageOutput> {
  const operationName = await startVeoGeneration({
    prompt: stageData.video_prompt as string,
    aspectRatio: "9:16",
    durationSeconds: 8,
    resolution: "720p",
  });
  return { stageData: { ...stageData, operation_name: operationName } };
}

async function stagePoll(stageData: Record<string, unknown>): Promise<VideoStageOutput> {
  const result = await getVeoOperation(stageData.operation_name as string);
  if (!result.done) return { stageData, retry: true };
  if (result.filtered || !result.videoUri) {
    throw new Error("Video generation was blocked by safety filtering — try a different product/angle");
  }
  return { stageData: { ...stageData, video_uri: result.videoUri } };
}

async function stageDownload(
  stageData: Record<string, unknown>,
  payload: GenerateVideoPayload
): Promise<VideoStageOutput> {
  // Download immediately — Google's own docs say this URI shouldn't be treated as a durable
  // long-term reference. Persisted into our own private Storage bucket, not stored as-is.
  const bytes = await downloadVeoVideo(stageData.video_uri as string);
  const path = `${payload.campaign_id}.mp4`;
  await uploadCampaignVideo(path, bytes, "video/mp4");
  return { stageData: { ...stageData, video_path: path } };
}

async function stageFinalize(stageData: Record<string, unknown>): Promise<VideoStageOutput> {
  return {
    stageData,
    campaignPatch: {
      video_path: stageData.video_path,
      video_status: "ready",
      video_error: null,
    },
  };
}

export async function runGenerateVideoStage(
  stageIndex: number,
  payload: GenerateVideoPayload,
  userId: string,
  workspaceId: string,
  stageData: Record<string, unknown>,
  usageCtx: { userId: string; jobId: string }
): Promise<VideoStageOutput> {
  const stage = GENERATE_VIDEO_STAGES[stageIndex];
  const usage: UsageContext = { ...usageCtx, jobType: "generate_video", stage };
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
      return stageDownload(stageData, payload);
    case "finalize":
      return stageFinalize(stageData);
    default:
      throw new Error(`Unknown generate_video stage index ${stageIndex}`);
  }
}
