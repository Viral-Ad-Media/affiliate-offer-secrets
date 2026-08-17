// One video interface over both providers, plus the rule for when to give up on one and try
// the next. SERVER-ONLY — it imports both provider clients. The catalog the UI needs is in
// lib/generationModels.ts, which imports nothing.
//
// Why this exists: two jobs terminally failed in a week with Google's "You exceeded your current
// quota, please check your plan and billing details." Each burned all 5 attempts first, because
// worker.ts cannot tell an exhausted account from a flaky one — both look like a throwing stage.
// A quota error is not a transient error and no number of retries fixes it; the only useful move
// is a different account. kie.ai resells the same Veo model on separate billing, which makes it
// the right second choice rather than merely an available one.

import { startVeoGeneration, getVeoOperation, downloadVeoVideo } from "@/lib/gemini/client";
import { createKieVeoTask, getKieVeoStatus, downloadKieResult, getKieCredit } from "@/lib/kieai/client";
import type { GenerationModel } from "@/lib/generationModels";

export type VideoAspect = "16:9" | "9:16";

/** Provider-agnostic handle for an in-flight render. Persisted in stage_data, so poll/download reach the right API. */
export type VideoTaskRef = string;

export async function submitVideo(
  model: GenerationModel,
  params: { prompt: string; aspectRatio: VideoAspect }
): Promise<VideoTaskRef> {
  if (model.provider === "gemini") {
    return startVeoGeneration({ prompt: params.prompt, aspectRatio: params.aspectRatio });
  }
  return createKieVeoTask({ prompt: params.prompt, model: model.apiModel, aspectRatio: params.aspectRatio });
}

export type VideoPoll = { done: boolean; url: string | null; error: string | null };

export async function pollVideo(model: GenerationModel, ref: VideoTaskRef): Promise<VideoPoll> {
  if (model.provider === "gemini") {
    const r = await getVeoOperation(ref);
    if (!r.done) return { done: false, url: null, error: null };
    // `filtered` is Veo refusing the prompt on safety grounds. Terminal and NOT account-level: the
    // second provider runs the same underlying model and would refuse it too, so this must reach
    // the job's normal failure path rather than the fallback.
    if (r.filtered) return { done: true, url: null, error: "The video model refused this prompt (content filtered)" };
    return { done: true, url: r.videoUri, error: null };
  }
  const s = await getKieVeoStatus(ref);
  if (!s.ready) return { done: false, url: null, error: null };
  return s.succeeded ? { done: true, url: s.videoUrl, error: null } : { done: true, url: null, error: s.failMsg };
}

export async function downloadVideo(model: GenerationModel, url: string): Promise<Buffer> {
  if (model.provider === "gemini") return downloadVeoVideo(url);
  const { bytes } = await downloadKieResult(url);
  return bytes;
}

/**
 * Is this failure a property of the ACCOUNT rather than of the request?
 *
 * Only these justify moving to another provider. A content refusal or a malformed prompt would be
 * refused by the second provider too, so retrying it there spends real credits to fail twice —
 * which is why "fall back on any hard failure" was considered and rejected.
 *
 * Matched on message text because neither client surfaces a stable machine-readable code for this:
 * Gemini returns a 429 whose body carries the quota prose, kie.ai returns its own `msg`. Both are
 * matched case-insensitively, and the list errs toward NOT falling back — an unmatched error keeps
 * today's behaviour exactly (retry, then fail), so a miss costs nothing that isn't already the
 * status quo.
 */
export function isAccountLevelFailure(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("exceeded your current quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("billing") ||
    msg.includes("insufficient") ||
    msg.includes("credit") ||
    msg.includes("payment") ||
    msg.includes("unauthorized") ||
    msg.includes("permission denied") ||
    msg.includes("api key") ||
    msg.includes("429") ||
    msg.includes("401") ||
    msg.includes("403") ||
    // A provider whose key isn't configured at all is account-level by definition — this is what
    // lets a deployment with only one of the two keys set still generate.
    msg.includes("is not set")
  );
}

/**
 * Submits to the first model in `chain` that isn't blocked at the account level.
 *
 * Returns which model actually accepted the job, so the caller can persist it — poll and download
 * MUST target the same provider that issued the reference, and a job is re-entered on a later
 * invocation with only stage_data to go on.
 *
 * A non-account-level error from the FIRST model is rethrown immediately rather than swallowed:
 * that is a real failure of this request and belongs in the job's normal retry path.
 */
export async function submitVideoWithFallback(
  chain: GenerationModel[],
  params: { prompt: string; aspectRatio: VideoAspect }
): Promise<{ ref: VideoTaskRef; model: GenerationModel; fellBackFrom: GenerationModel | null; note: string | null }> {
  let firstFailure: { model: GenerationModel; err: unknown } | null = null;

  for (const model of chain) {
    try {
      const ref = await submitVideo(model, params);
      if (!firstFailure) return { ref, model, fellBackFrom: null, note: null };
      const credit = model.provider === "kieai" ? await getKieCredit() : null;
      const why = firstFailure.err instanceof Error ? firstFailure.err.message : String(firstFailure.err);
      return {
        ref,
        model,
        fellBackFrom: firstFailure.model,
        note:
          `${firstFailure.model.label} was unavailable (${why.slice(0, 160)}) — generated with ${model.label} instead` +
          (credit !== null ? `. kie.ai balance: ${credit} credits.` : "."),
      };
    } catch (err) {
      if (!isAccountLevelFailure(err)) throw err;
      if (!firstFailure) firstFailure = { model, err };
    }
  }

  // Every provider is blocked. Throw the FIRST failure — it names the model the operator chose,
  // which is the one they need to fix, rather than whichever fallback happened to be last.
  throw firstFailure?.err ?? new Error("No video model available");
}
