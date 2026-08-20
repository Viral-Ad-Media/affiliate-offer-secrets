// The workspace's default model per media kind, and how a request's override combines with it.
//
// SERVER-ONLY (it takes a Supabase client). The catalog itself is isomorphic in
// lib/generationModels.ts, which is what the pickers import.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveModel, type MediaKind, type GenerationModel } from "@/lib/generationModels";

export type WorkspaceGenerationDefaults = {
  image: string | null;
  video: string | null;
  // Daily generation credit cap (0119). null = no cap (unlimited).
  dailyBudget: number | null;
};

export async function getWorkspaceGenerationDefaults(
  client: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceGenerationDefaults> {
  const { data } = await client
    .from("workspaces")
    .select("default_image_model, default_video_model, daily_generation_credit_cap")
    .eq("id", workspaceId)
    .maybeSingle();
  return {
    image: (data?.default_image_model as string | null) ?? null,
    video: (data?.default_video_model as string | null) ?? null,
    dailyBudget: (data?.daily_generation_credit_cap as number | null) ?? null,
  };
}

/**
 * Resolves the model for one generation: the request's override, else the workspace default, else
 * the catalog default.
 *
 * **Resolved at QUEUE time, not in the worker**, and that ordering is deliberate. The worker can
 * run minutes later and re-runs stages on retry; reading the workspace default there would let a
 * settings change mid-flight silently repoint an in-progress job, and a job that fell back to a
 * second provider could be re-resolved back to the exhausted one. Freezing the choice into the
 * payload makes the job describe itself.
 *
 * Never throws on a bad override — an unknown id falls through to the default, same as everywhere
 * else models are resolved. A caller sending a typo gets a generation, not a 400.
 */
export async function resolveGenerationModel(
  client: SupabaseClient,
  workspaceId: string,
  kind: MediaKind,
  override?: unknown
): Promise<GenerationModel> {
  const defaults = await getWorkspaceGenerationDefaults(client, workspaceId);
  return resolveModel(kind, override, kind === "image" ? defaults.image : defaults.video);
}
