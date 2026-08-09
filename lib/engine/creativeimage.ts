import { db } from "./core";
import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { createKieTask, getKieTaskStatus, downloadKieResult } from "@/lib/kieai/client";
import { isValidImageDataUrl, MAX_AD_IMAGE_DATA_URL_CHARS } from "@/lib/images/validate";
import type { FbAdAngle, SocialPost } from "@/lib/shared";

// Per-item generalization of adimage.ts — same stage shape, but reads/writes one
// campaign_creatives row instead of a single campaigns column, seeded from that one angle's/
// post's own copy instead of the whole fb_ads_md blob.
export { GENERATE_CREATIVE_IMAGE_STAGES } from "@/lib/generationStages";
import { GENERATE_CREATIVE_IMAGE_STAGES } from "@/lib/generationStages";
export type GenerateCreativeImageStage = (typeof GENERATE_CREATIVE_IMAGE_STAGES)[number];

export type GenerateCreativeImagePayload = {
  campaign_creative_id: string;
};

export type CreativeImageStageOutput = {
  stageData: Record<string, unknown>;
  creativePatch?: Record<string, unknown>;
  retry?: boolean;
};

// The real security boundary for this job type — jobs' own RLS only validates the row's
// user_id, not payload contents, so a forged campaign_creative_id must be caught here, not just
// at the API route that queues the job. Same pattern as adimage.ts/adlaunch.ts's stageVerify.
async function stageVerify(
  payload: GenerateCreativeImagePayload,
  workspaceId: string
): Promise<CreativeImageStageOutput> {
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
    stageData: { product_id: campaign.product_id, tone_text: toneText },
  };
}

async function stagePrompt(
  stageData: Record<string, unknown>,
  usage: UsageContext
): Promise<CreativeImageStageOutput> {
  const { data: product } = await db
    .from("products")
    .select("product_title, niche, description")
    .eq("id", stageData.product_id)
    .maybeSingle();
  if (!product) throw new Error("Product not found");

  const result = await completeJSON<{ image_prompt: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `Product: "${product.product_title}" (${product.niche})\n${product.description ?? ""}\n\nCopy for this specific creative, for tone reference:\n${stageData.tone_text}\n\nWrite a single, detailed image-generation prompt (for an AI image model) describing an original, policy-compliant advertising creative image for this product, matching the tone of the copy above — a clean, professional, ad-style visual (product-in-context, lifestyle/mechanism visual, or abstract concept art appropriate to the niche). Do not describe any text/words to render in the image. Never depict real people, celebrities, medical/before-after imagery, or anything that could read as a fabricated testimonial.`,
    schema: {
      type: "object",
      properties: { image_prompt: { type: "string" } },
      required: ["image_prompt"],
    },
    maxTokens: 500,
    usage,
  });

  return { stageData: { ...stageData, image_prompt: result.image_prompt } };
}

async function stageSubmit(stageData: Record<string, unknown>): Promise<CreativeImageStageOutput> {
  const taskId = await createKieTask("nano-banana-2", {
    prompt: stageData.image_prompt,
    aspect_ratio: "1:1",
    output_format: "png",
  });
  return { stageData: { ...stageData, task_id: taskId } };
}

async function stagePoll(stageData: Record<string, unknown>): Promise<CreativeImageStageOutput> {
  const status = await getKieTaskStatus(stageData.task_id as string);
  if (!status.ready) return { stageData, retry: true };
  if (!status.succeeded) throw new Error(status.failMsg ?? "Image generation failed");
  if (status.resultUrls.length === 0) throw new Error("Image generation returned no result");
  return { stageData: { ...stageData, result_url: status.resultUrls[0] } };
}

async function stageFinalize(stageData: Record<string, unknown>): Promise<CreativeImageStageOutput> {
  const { bytes, contentType } = await downloadKieResult(stageData.result_url as string);
  const dataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;

  if (!isValidImageDataUrl(dataUrl, MAX_AD_IMAGE_DATA_URL_CHARS)) {
    throw new Error(`Generated image failed validation (content-type: ${contentType}, size: ${bytes.length} bytes)`);
  }

  return { stageData, creativePatch: { image_data_url: dataUrl, status: "ready", error: null } };
}

export async function runGenerateCreativeImageStage(
  stageIndex: number,
  payload: GenerateCreativeImagePayload,
  userId: string,
  workspaceId: string,
  stageData: Record<string, unknown>,
  usageCtx: { userId: string; jobId: string }
): Promise<CreativeImageStageOutput> {
  const stage = GENERATE_CREATIVE_IMAGE_STAGES[stageIndex];
  const usage: UsageContext = { ...usageCtx, jobType: "generate_creative_image", stage };
  switch (stage) {
    case "verify":
      return stageVerify(payload, workspaceId);
    case "prompt":
      return stagePrompt(stageData, usage);
    case "submit":
      return stageSubmit(stageData);
    case "poll":
      return stagePoll(stageData);
    case "finalize":
      return stageFinalize(stageData);
    default:
      throw new Error(`Unknown generate_creative_image stage index ${stageIndex}`);
  }
}
