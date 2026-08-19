import { db } from "./core";
import { uploadImageRef, CLD_FOLDER } from "@/lib/cloudinary/upload";
import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { createKieTask, getKieTaskStatus, downloadKieResult, kieImageInput } from "@/lib/kieai/client";
import { resolveModel } from "@/lib/generationModels";
import { isValidImageDataUrl, ALLOWED_IMAGE_CONTENT_TYPES } from "@/lib/images/validate";
import { MAX_FEATURED_IMAGE_CHARS } from "@/lib/blog";

// Featured-image generation for a blog post — same stage shape as creativeimage.ts, but seeded
// from the post's own title/content and writing back to blog_posts instead of campaign_creatives.
// 16:9 (not the ad creative's 1:1) because this renders as a full-width hero on the post page and
// as the card thumbnail on the blog index.
export { GENERATE_BLOG_IMAGE_STAGES } from "@/lib/generationStages";
import { GENERATE_BLOG_IMAGE_STAGES } from "@/lib/generationStages";
export type GenerateBlogImageStage = (typeof GENERATE_BLOG_IMAGE_STAGES)[number];

export type GenerateBlogImagePayload = {
  post_id: string;
  /** Chosen model, resolved at queue time. Absent = the workspace/catalog default. */
  model_id?: string | null;
};

export type BlogImageStageOutput = {
  stageData: Record<string, unknown>;
  postPatch?: Record<string, unknown>;
  retry?: boolean;
};

// The real security boundary for this job type — jobs' own RLS only validates the row's user_id,
// not payload contents, so a forged post_id must be caught here, not just at the API route that
// queues the job. Same pattern as creativeimage.ts/adlaunch.ts's stageVerify.
async function stageVerify(payload: GenerateBlogImagePayload, workspaceId: string, userId: string): Promise<BlogImageStageOutput> {
  const { data: post } = await db
    .from("blog_posts")
    .select("id, title, content_md, html")
    .eq("id", payload.post_id)
    .eq("workspace_id", workspaceId)
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

  return {
    stageData: { title: post.title, body, workspace_id: workspaceId, user_id: userId, model_id: payload.model_id ?? null },
  };
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
  // JPEG, not PNG — and this is the actual bug fix, not a preference.
  //
  // A 16:9 PNG straight out of nano-banana-2 was observed at 7.9 MB, against a 900 KB cap, so this
  // job failed EVERY time rather than occasionally: PNG is lossless and a full-resolution
  // photographic hero simply cannot fit. The cap itself is correct and shouldn't just be raised —
  // featured_image_url is stored as a data URL and inlined into the public blog HTML, both as the
  // post's hero and as the thumbnail on every index card, so a multi-megabyte image would be
  // re-sent inside the page on every load, twelve times over on a full index page.
  //
  // "jpg", not "jpeg" — VERIFIED against kie.ai's own parameter schema, whose output_format enum
  // is exactly ["png", "jpg"]. It shipped as "jpeg" (inferred, since the docs 404'd from here) and
  // failed every real run with "output_format is not within the range of allowed options". The
  // lesson is the one this codebase already applies to every other external API: check the real
  // shape before writing against it, and treat an inferred value as a known defect until you have.
  // resolution "1K" is explicit for the same reason output_format is: leaving it off means the
  // API's own default applies, and a 3033KB JPEG came back against a ~1953KB cap — so the job
  // failed on size after paying for the generation. VERIFIED against kie.ai's parameter schema,
  // whose resolution enum is exactly ["1K", "2K", "4K"].
  //
  // 1K is the right size, not a workaround: this image is a blog hero rendered at ~1200px at most
  // and a small card thumbnail on the index, and it ships base64-inlined in the HTML of every page
  // that shows it. 2K/4K would buy detail nobody sees and re-send it on every page load.
  const blogModel = resolveModel("image", stageData.model_id).apiModel;
  const taskId = await createKieTask(
    blogModel,
    kieImageInput(blogModel, { prompt: stageData.image_prompt, aspectRatio: "16:9", format: "jpg", resolution: "1K" })
  );
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
  // The two failure reasons are separated because they mean completely different things to whoever
  // reads the error on the post: a disallowed type is a security stop, an oversized image is a
  // tuning problem. The old combined message ("failed validation, 7957747 bytes") read like a bug
  // in the validator rather than "the model returned something too big to inline".
  if (!isValidImageDataUrl(dataUrl, MAX_FEATURED_IMAGE_CHARS)) {
    const allowed = ALLOWED_IMAGE_CONTENT_TYPES.includes(contentType.toLowerCase());
    throw new Error(
      allowed
        ? `Generated image is too large to embed (${Math.round(bytes.length / 1024)}KB, limit ${Math.round(
            MAX_FEATURED_IMAGE_CHARS / 1024
          )}KB of encoded data). Upload your own image instead.`
        : `Generated image had an unsupported content-type (${contentType})`
    );
  }

  // Hosted before it is written, so the post never stores base64 in the first place. Falls back
  // to the data URI if Cloudinary is unconfigured or the upload fails — a generated image is
  // worth keeping either way, and the backfill can move it later.
  const hosted = (await uploadImageRef(db, dataUrl, CLD_FOLDER.blog, {
    workspaceId: stageData.workspace_id as string,
    userId: stageData.user_id as string,
  })) ?? dataUrl;

  return {
    stageData,
    postPatch: { featured_image_url: hosted, featured_image_status: "ready", featured_image_error: null },
  };
}

export async function runGenerateBlogImageStage(
  stageIndex: number,
  payload: GenerateBlogImagePayload,
  userId: string,
  workspaceId: string,
  stageData: Record<string, unknown>,
  usageCtx: { userId: string; jobId: string }
): Promise<BlogImageStageOutput> {
  const stage = GENERATE_BLOG_IMAGE_STAGES[stageIndex];
  const usage: UsageContext = { ...usageCtx, jobType: "generate_blog_image", stage };
  switch (stage) {
    case "verify":
      return stageVerify(payload, workspaceId, userId);
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
