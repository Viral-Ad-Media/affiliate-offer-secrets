import { GENERATION_STAGES, type GenerationJobType } from "@/lib/generationStages";

/**
 * "43%" for an image/video generation in flight, plus what is actually happening right now.
 *
 * Derived from `jobs.stage` exactly like `lib/buildProgress.ts` derives the build checklist — the
 * worker advances that column only once a stage's output is really committed, so a percentage
 * here can never claim progress the job hasn't made. There is no separate progress column to keep
 * in sync, and nothing to write from a stage handler (which re-runs on every retry).
 *
 * **The percentage is honest rather than smooth, and that is deliberate.** `poll` is one stage but
 * most of the wall-clock time — a Veo render is minutes — so the bar sits still there while the
 * label says why. A bar that crept upward on a timer would be inventing progress: it would imply
 * the render is nearly done at the exact moment nobody knows whether it is.
 */

const STAGE_LABELS: Record<string, string> = {
  verify: "Checking the request",
  prompt: "Writing the prompt",
  script: "Writing the script",
  submit: "Sending it to the generator",
  poll: "Generating",
  download: "Downloading the result",
  finalize: "Saving it",
};

/** The one stage that can legitimately take minutes — worth saying so instead of looking stuck. */
const SLOW_STAGES = new Set(["poll"]);

export type GenerationProgressState = {
  percent: number;
  label: string;
  /** True while waiting on the external generator, where a still bar is expected, not a stall. */
  slow: boolean;
  stageIndex: number;
  totalStages: number;
};

export function generationProgress(
  type: GenerationJobType,
  stage: number | null | undefined,
): GenerationProgressState {
  const stages = GENERATION_STAGES[type];
  const total = stages.length;
  // Clamp: a stage index past the end means the job finished between the poll and this render.
  const index = Math.min(Math.max(stage ?? 0, 0), total);
  const name = stages[index] ?? stages[total - 1];
  return {
    // Floor at 5 so a just-queued job reads as started rather than as a stuck empty bar; the
    // number is stages COMMITTED, so it only ever moves on real work.
    percent: index === 0 ? 5 : Math.round((index / total) * 100),
    label: STAGE_LABELS[name] ?? "Working",
    slow: SLOW_STAGES.has(name),
    stageIndex: index,
    totalStages: total,
  };
}
