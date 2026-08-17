import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePageCopy } from "@/lib/engine/renderPages";
import { funnelPageChecklist, funnelStepChecklist, type ChecklistItem } from "@/lib/pageChecklist";
import { STEP_TYPE_LABELS } from "@/lib/funnelTypes";
import type { FunnelStepType } from "@/lib/shared";

/** Labels of the REQUIRED items still outstanding. Recommended ones never block publishing. */
function missingRequired(items: ChecklistItem[]): string[] {
  return items.filter((i) => i.severity === "required" && !i.done).map((i) => i.label);
}

export type PublishBlockers = { notReady: boolean; missing: string[] };

/**
 * Everything standing between a funnel and going live.
 *
 * Extracted from the single-publish route so the BULK path enforces the identical gate. A bulk
 * action that published without this would be strictly more permissive than pressing the button
 * once — the inverse of the trap CLAUDE.md already records for bulk publish on blog posts, where
 * a bulk path doing LESS than the single one was the thing to avoid. Either direction is the same
 * mistake: the two paths must mean the same thing.
 *
 * Reads through whichever client the caller passes; both current callers hand it the admin client,
 * having already established ownership.
 */
export async function funnelPublishBlockers(
  admin: SupabaseClient,
  campaignId: string
): Promise<PublishBlockers> {
  const { data: campaign } = await admin
    .from("campaigns")
    .select("status, bridge_html, page_copy, funnel_type")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign || campaign.status !== "ready" || !campaign.bridge_html) {
    return { notReady: true, missing: [] };
  }

  const missing = missingRequired(
    funnelPageChecklist(campaign.funnel_type, normalizePageCopy(campaign.page_copy, null))
  );

  // One publish switch covers the opt-in page AND every step, so a step missing its essentials
  // would go live under the same toggle — it has to be checked here too or the gate only guards
  // the first page of the funnel.
  const { data: steps } = await admin
    .from("funnel_steps")
    .select("step_type, step_index, page_copy")
    .eq("campaign_id", campaignId)
    .order("step_index");

  for (const s of steps ?? []) {
    const stepMissing = missingRequired(
      funnelStepChecklist(s.step_type, normalizePageCopy(s.page_copy, null, { stepType: s.step_type }))
    );
    missing.push(
      ...stepMissing.map(
        (m) => `Step ${s.step_index} (${STEP_TYPE_LABELS[s.step_type as FunnelStepType]}): ${m}`
      )
    );
  }

  return { notReady: false, missing };
}
