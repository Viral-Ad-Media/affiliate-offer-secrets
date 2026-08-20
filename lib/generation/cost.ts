import { db } from "@/lib/engine/core";
import { resolveModel, type MediaKind } from "@/lib/generationModels";

// Cost-to-serve tracking for kie.ai / Veo image & video generation. Anthropic calls already record
// exact cost to usage_ledger (recordUsage), but image/video generation recorded NOTHING — so the
// operator was blind on the exact line with the tightest margin (video: $10 charged vs a Veo clip
// that can cost several dollars). This records an ESTIMATED per-generation cost into the same
// usage_ledger, so it shows up in the audit ledger and margin can be read off real usage.
//
// These are ESTIMATES from published provider pricing, NOT metered billing — the providers don't
// return a per-call cost, so a flat per-generation figure per model is the honest best we can do.
// Update EST_COST_USD when a provider's pricing changes. Keyed by OUR model id (lib/generationModels).
const EST_COST_USD: Record<string, number> = {
  // Video — the margin-critical line. Google Veo direct is the expensive one (~8s clip).
  "gemini-veo-3.1": 3.2,
  "kie-veo3": 2.0,
  "kie-veo3-fast": 0.8,
  "kie-grok-video": 0.5,
  "kie-kling-2-6": 0.5,
  // Image — cheap across the board, so $2 charged is comfortable margin either way.
  "nano-banana-2": 0.04,
  "nano-banana-2-lite": 0.02,
  "kie-grok-image": 0.05,
  "kie-gpt-image-2": 0.12,
  "kie-seedream-5-lite": 0.03,
  "kie-flux-2-pro": 0.05,
};

// Fallback when a model id isn't in the table (a new model added to the catalog before its price is
// filled in): a conservative non-zero figure per kind, so cost is never silently recorded as $0.
const FALLBACK_USD: Record<MediaKind, number> = { image: 0.1, video: 2.0 };

export function estGenerationCostUsd(modelId: string | null | undefined, kind: MediaKind): number {
  if (modelId && modelId in EST_COST_USD) return EST_COST_USD[modelId];
  return FALLBACK_USD[kind];
}

/**
 * Record the estimated cost of one image/video generation into usage_ledger. Best-effort and never
 * throws — a cost-tracking failure must never fail the generation it is measuring (the recordUsage
 * discipline). Zero tokens (there are none); the money lives in cost_usd.
 *
 * `modelId` is the model that SUCCEEDED (from stage_data.model_id, after any fallback), so the
 * recorded cost reflects the account actually billed — the whole reason model was persisted.
 */
export async function recordGenerationCost(
  job: { id: string; user_id: string; type: string },
  modelId: string | null | undefined,
  kind: MediaKind
): Promise<void> {
  try {
    // resolveModel skips an unknown id and returns the default, so the recorded model reads sanely
    // even for a legacy job with no stored model_id.
    const model = resolveModel(kind, modelId ?? null);
    const cost = estGenerationCostUsd(model.id, kind);
    const { error } = await db.from("usage_ledger").insert({
      user_id: job.user_id,
      job_id: job.id,
      job_type: job.type,
      stage: "generation",
      model: model.id,
      input_tokens: 0,
      output_tokens: 0,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      cost_usd: cost,
    });
    if (error) console.error("[generationCost] insert failed:", error.message);
  } catch (err) {
    console.error("[generationCost] threw:", (err as Error).message);
  }
}
