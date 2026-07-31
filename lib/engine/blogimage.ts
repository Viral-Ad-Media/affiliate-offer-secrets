import { db } from "./core";
import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { createKieTask, getKieTaskStatus, downloadKieResult } from "@/lib/kieai/client";
import { isValidImageDataUrl } from "@/lib/images/validate";
import { MAX_FEATURED_IMAGE_CHARS } from "@/lib/blog";

// Featured-image generation for a blog post — same stage shape as creativeimage.ts, but seeded
// from the post's own title/content and writing back to blog_posts instead of campaign_creatives.
// 16:9 (not the ad creative's 1:1) because this renders as a full-width hero on the post page and
// as the card thumbnail on the blog index.
export const GENERATE_BLOG_IMAGE_STAGES = ["verify", "prompt", "submit", "poll", "finalize"] as const;
export type GenerateBlogImageStage = (typeof GENERATE_BLOG_IMAGE_STAGES)[number];

export type GenerateBlogImagePayload = { post_id: string };

export type BlogImageStageOutput = {
  stageData: Record<string, unknown>;
  postPatch?: Record<string, unknown>;
  retry?: boolean;
};

// The real security boundary for this job type — jobs' own RLS only validates the row's user_id,
// not payload contents, so a forged post_id must be caught here, not just at the API route that
// queues the job. Same pattern as creativeimage.ts/adlaunch.ts's stageVerify.
async function stageVerify(payload: GenerateBlogImagePayload, userId: string): Promise<BlogImageStageOutput> {
  const { data: post } = await db
    .from("blog_posts")
    .select("id, title, content_md, html")
    .eq("id", payload.post_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!post) throw new Error("Post not found for this account");

  // Strip markup/markdown to give the prompt stage clean subject matter, capped so a long article
  // doesn't blow the token budget.
  const body = ((post.content_md as string) || (post.html as string) || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);

  return { stageData: { title: post.title, body } };
}

async function stagePrompt(stageData: Record<string, unknown>, usage: UsageContext): Promise<BlogImageStageOutput> {
  const result = await completeJSON<{ image_prompt: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `Blog post title: "${stageData.title}"\n\nArticle excerpt:\n${stageData.body}\n\nWrite a single, detailed image-generation prompt (for an AI image model) describing an original, policy-compliant FEATURED IMAGE for this article — an editorial header image in a wide 16:9 composition. Favour clean, modern editorial photography or tasteful conceptual illustration that evokes the article's subject. Do not describe any text, words, letters, logos or watermarks to render in the image. Never depict real people, celebrities, medical/before-after imagery, or anything that could read as a fabricated testimonial or a health claim.`,
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

async function stageSubmit(stageData: Record<string, unknown>): Promise<BlogImageStageOutput> {
  const taskId = await createKieTask("nano-banana-2", {
    prompt: stageData.image_prompt,
    aspect_ratio: "16:9",
    output_format: "png",
  });
  return { stageData: { ...stageData, task_id: taskId } };
}

async function stagePoll(stageData: Record<string, unknown>): Promise<BlogImageStageOutput> {
  const status = await getKieTaskStatus(stageData.task_id as string);
  if (!status.ready) return { stageData, retry: true };
  if (!status.succeeded) throw new Error(status.failMsg ?? "Image generation failed");
  if (status.resultUrls.length === 0) throw new Error("Image generation returned no result");
  return { stageData: { ...stageData, result_url: status.resultUrls[0] } };
}

async function stageFinalize(stageData: Record<string, unknown>): Promise<BlogImageStageOutput> {
  const { bytes, contentType } = await downloadKieResult(stageData.result_url as string);
  const dataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;

  // Never trust the generator's claimed content-type — same allowlist every other image path uses.
  if (!isValidImageDataUrl(dataUrl, MAX_FEATURED_IMAGE_CHARS)) {
    throw new Error(`Generated image failed validation (content-type: ${contentType}, size: ${bytes.length} bytes)`);
  }

  return {
    stageData,
    postPatch: { featured_image_url: dataUrl, featured_image_status: "ready", featured_image_error: null },
  };
}

export async function runGenerateBlogImageStage(
  stageIndex: number,
  payload: GenerateBlogImagePayload,
  userId: string,
  stageData: Record<string, unknown>,
  usageCtx: { userId: string; jobId: string }
): Promise<BlogImageStageOutput> {
  const stage = GENERATE_BLOG_IMAGE_STAGES[stageIndex];
  const usage: UsageContext = { ...usageCtx, jobType: "generate_blog_image", stage };
  switch (stage) {
    case "verify":
      return stageVerify(payload, userId);
    case "prompt":
      return stagePrompt(stageData, usage);
    case "submit":
      return stageSubmit(stageData);
    case "poll":
      return stagePoll(stageData);
    case "finalize":
      return stageFinalize(stageData);
    default:
      throw new Error(`Unknown generate_blog_image stage index ${stageIndex}`);
  }
}
