import { BUILD_CAMPAIGN_STAGES } from "@/lib/buildStages";
import { normalizeKitAssets, type KitAssetKey } from "@/lib/kitAssets";

/**
 * Turns a build_campaign job row into a checklist a person can read.
 *
 * The stage names the engine uses ("context", "pages", "social") are internal; these are what the
 * work actually is. Kept next to the engine's own stage list rather than duplicated in a component
 * so adding a stage can't silently leave the checklist a step short.
 */

export type BuildStepState = "done" | "active" | "pending" | "skipped";

export type BuildStep = {
  key: string;
  label: string;
  /** What the person gets out of it — not what the code does. */
  detail: string;
  state: BuildStepState;
};

const STEP_META: Record<
  (typeof BUILD_CAMPAIGN_STAGES)[number],
  { label: string; detail: string; needs?: KitAssetKey }
> = {
  context: { label: "Reading the sales page", detail: "Pulling the offer's own copy and images" },
  image: { label: "Choosing a product image", detail: "Picking a usable shot from the page", needs: "funnel" },
  ads: { label: "Writing ad angles", detail: "Facebook/Instagram angles and a TikTok script" },
  pages: { label: "Building the funnel page", detail: "Opt-in page with your affiliate link", needs: "funnel" },
  content: { label: "Writing the blog post", detail: "A long-form article for the offer", needs: "blog" },
  social: { label: "Writing social + email", detail: "Captions and an email sequence" },
};

/**
 * The checklist for one job.
 *
 * A stage the chosen assets skip is shown as SKIPPED rather than hidden: someone who unticked
 * "blog" should see that the blog step isn't running, not wonder why the list is shorter than
 * last time. Progress is derived from jobs.stage, which the worker advances as it commits each
 * stage — so a step shows done only once its output is actually saved.
 */
export function buildSteps(job: {
  stage?: number | null;
  status?: string | null;
  payload?: { assets?: unknown } | null;
}): BuildStep[] {
  const assets = normalizeKitAssets(job.payload?.assets);
  const wants = (a?: KitAssetKey) => !a || assets.includes(a);
  const at = typeof job.stage === "number" ? job.stage : 0;
  const failed = job.status === "error";
  const finished = job.status === "done";

  return BUILD_CAMPAIGN_STAGES.map((key, i) => {
    const meta = STEP_META[key];
    const state: BuildStepState = !wants(meta.needs)
      ? "skipped"
      : finished || i < at
        ? "done"
        : i === at && !failed
          ? "active"
          : "pending";
    return { key, label: meta.label, detail: meta.detail, state };
  });
}

/** 0-100, counting skipped steps as complete — they're not work that's still owed. */
export function buildPercent(steps: BuildStep[]): number {
  if (steps.length === 0) return 0;
  const done = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  return Math.round((done / steps.length) * 100);
}
