/**
 * Stage lists for the four image/video generation job types, in an ISOMORPHIC file.
 *
 * Same reason `lib/buildStages.ts` exists and `BUILD_CAMPAIGN_STAGES` doesn't live in
 * `lib/engine/build.ts`: importing one of these constants from its engine module drags the kie.ai/
 * Gemini/Storage clients — and `node:*` — into a client bundle. `tsc --noEmit` passes and
 * `next build` fails. Each engine module re-exports its list from here, so every server-side
 * importer is unchanged.
 *
 * Zero imports on purpose. Anything added here must stay a plain literal.
 */

export const GENERATE_AD_IMAGE_STAGES = ["verify", "prompt", "submit", "poll", "finalize"] as const;
export const GENERATE_CREATIVE_IMAGE_STAGES = ["verify", "prompt", "submit", "poll", "finalize"] as const;
export const GENERATE_BLOG_IMAGE_STAGES = ["verify", "prompt", "submit", "poll", "finalize"] as const;

export const GENERATE_VIDEO_STAGES = [
  "verify",
  "script",
  "submit",
  "poll",
  "download",
  "finalize",
] as const;
export const GENERATE_CREATIVE_VIDEO_STAGES = [
  "verify",
  "script",
  "submit",
  "poll",
  "download",
  "finalize",
] as const;

/** Every job type this progress model covers. */
export const GENERATION_JOB_TYPES = [
  "generate_ad_image",
  "generate_creative_image",
  "generate_blog_image",
  "generate_video",
  "generate_creative_video",
] as const;

export type GenerationJobType = (typeof GENERATION_JOB_TYPES)[number];

export const GENERATION_STAGES: Record<GenerationJobType, readonly string[]> = {
  generate_ad_image: GENERATE_AD_IMAGE_STAGES,
  generate_creative_image: GENERATE_CREATIVE_IMAGE_STAGES,
  generate_blog_image: GENERATE_BLOG_IMAGE_STAGES,
  generate_video: GENERATE_VIDEO_STAGES,
  generate_creative_video: GENERATE_CREATIVE_VIDEO_STAGES,
};
