import { db } from "./core";
import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { createKieTask, getKieTaskStatus, downloadKieResult } from "@/lib/kieai/client";
import { isValidImageDataUrl, MAX_AD_IMAGE_DATA_URL_CHARS } from "@/lib/images/validate";

// Re-exported from the isomorphic list so a client component can read it without pulling this
// module (and the kie.ai client) into the browser bundle — see lib/generationStages.ts.
export { GENERATE_AD_IMAGE_STAGES } from "@/lib/generationStages";
import { GENERATE_AD_IMAGE_STAGES } from "@/lib/generationStages";
export type GenerateAdImageStage = (typeof GENERATE_AD_IMAGE_STAGES)[number];

export type GenerateAdImagePayload = {
  campaign_id: string;
};

export type AdImageStageOutput = {
  stageData: Record<string, unknown>;
  campaignPatch?: Record<string, unknown>;
  retry?: boolean;
};

// The real security boundary for this job type — jobs' own RLS only validates the row's
// user_id, not payload contents, so a forged campaign_id must be caught here, not just at the
// API route that queues the job. Same pattern as adlaunch.ts's stageVerify.
async function stageVerify(
  payload: GenerateAdImagePayload,
  workspaceId: string
): Promise<AdImageStageOutput> {
  const { data: campaign } = await db
    .from("campaigns")
    .select("id, product_id, fb_ads_md")
    .eq("id", payload.campaign_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign not found for this account");

  return {
    stageData: { product_id: campaign.product_id, fb_ads_md: campaign.fb_ads_md ?? "" },
  };
}

async function stagePrompt(
  stageData: Record<string, unknown>,
  usage: UsageContext
): Promise<AdImageStageOutput> {
  const { data: product } = await db
    .from("products")
    .select("product_title, niche, description")
    .eq("id", stageData.product_id)
    .maybeSingle();
  if (!product) throw new Error("Product not found");

  const result = await completeJSON<{ image_prompt: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `Product: "${product.product_title}" (${product.niche})\n${product.description ?? ""}\n\nExisting ad copy for tone reference:\n${(stageData.fb_ads_md as string).slice(0, 2000)}\n\nWrite a single, detailed image-generation prompt (for an AI image model) describing an original, policy-compliant advertising creative image for this product — a clean, professional, ad-style visual (product-in-context, lifestyle/mechanism visual, or abstract concept art appropriate to the niche). Do not describe any text/words to render in the image. Never depict real people, celebrities, medical/before-after imagery, or anything that could read as a fabricated testimonial.`,
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

async function stageSubmit(stageData: Record<string, unknown>): Promise<AdImageStageOutput> {
  const taskId = await createKieTask("nano-banana-2", {
    prompt: stageData.image_prompt,
    aspect_ratio: "1:1",
    output_format: "png",
  });
  return { stageData: { ...stageData, task_id: taskId } };
}

async function stagePoll(stageData: Record<string, unknown>): Promise<AdImageStageOutput> {
  const status = await getKieTaskStatus(stageData.task_id as string);
  if (!status.ready) return { stageData, retry: true };
  if (!status.succeeded) throw new Error(status.failMsg ?? "Image generation failed");
  if (status.resultUrls.length === 0) throw new Error("Image generation returned no result");
  return { stageData: { ...stageData, result_url: status.resultUrls[0] } };
}

async function stageFinalize(stageData: Record<string, unknown>): Promise<AdImageStageOutput> {
  const { bytes, contentType } = await downloadKieResult(stageData.result_url as string);
  const dataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;

  // Never trust kie.ai's claimed content-type or the request having succeeded blindly — same
  // allowlist every other image-touching path in this app enforces (lib/images/validate.ts).
  // Uses the larger ad-image cap, not the default — these are full-resolution generated photos
  // (observed ~2.7MB decoded), not small vendor product shots.
  if (!isValidImageDataUrl(dataUrl, MAX_AD_IMAGE_DATA_URL_CHARS)) {
    throw new Error(`Generated image failed validation (content-type: ${contentType}, size: ${bytes.length} bytes)`);
  }

  return { stageData, campaignPatch: { ad_creative_image_data_url: dataUrl } };
}

export async function runGenerateAdImageStage(
  stageIndex: number,
  payload: GenerateAdImagePayload,
  userId: string,
  workspaceId: string,
  stageData: Record<string, unknown>,
  usageCtx: { userId: string; jobId: string }
): Promise<AdImageStageOutput> {
  const stage = GENERATE_AD_IMAGE_STAGES[stageIndex];
  const usage: UsageContext = { ...usageCtx, jobType: "generate_ad_image", stage };
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
      throw new Error(`Unknown generate_ad_image stage index ${stageIndex}`);
  }
}
