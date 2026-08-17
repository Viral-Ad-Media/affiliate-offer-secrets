import type { createAdminClient } from "@/lib/supabase/admin";
import { CAMPAIGN_VIDEOS_BUCKET } from "@/lib/supabase/storage";

type AdminClient = ReturnType<typeof createAdminClient>;

export type VideoSweepResult = { removed: number; failures: string[] };

/**
 * Delete the stored videos belonging to campaigns that no longer exist.
 *
 * `campaign_creatives` cascades from `campaigns`, so deleting a campaign takes the ROWS that point
 * at these files — but no foreign key reaches Supabase Storage, so the mp4s themselves survive with
 * nothing referencing them. Wasted bytes rather than a leak (every URL for one is minted on demand
 * from a live row, so an orphan is unreachable), but they accumulate forever and nothing else would
 * ever collect them.
 *
 * Extracted from app/api/account/delete/route.ts, which had the only copy of this. Deleting a
 * campaign from the funnels list needed exactly the same sweep, and a second implementation of
 * "which paths belong to this campaign" is how the two end up disagreeing about the legacy flat
 * layout below.
 *
 * TWO PATH SHAPES, both handled: `${campaignId}/${source}-${index}.mp4` (per-item, current) and a
 * legacy flat `${campaignId}.mp4` from before creatives were per-item. The flat one cannot be
 * discovered by listing the folder — it is a sibling of the folder, not a child — so it is added
 * unconditionally and a miss on remove costs nothing.
 *
 * **Verifies the campaign is really gone before removing anything.** Called after a delete, but a
 * caller that got its list wrong would otherwise destroy the videos of a live campaign, and there
 * is no undo for that. Anything still present in `campaigns` is skipped.
 *
 * Best-effort by design: returns failures rather than throwing. A storage problem must never turn a
 * completed delete into a reported error, which would invite a retry of something already done.
 */
export async function sweepDeletedCampaignVideos(
  admin: AdminClient,
  campaignIds: string[]
): Promise<VideoSweepResult> {
  const ids = Array.from(new Set(campaignIds.filter(Boolean)));
  if (ids.length === 0) return { removed: 0, failures: [] };

  const failures: string[] = [];

  const { data: live, error: liveError } = await admin.from("campaigns").select("id").in("id", ids);
  if (liveError) {
    // Could not confirm what is gone, so remove nothing. Orphaned files are recoverable disk;
    // deleting a live campaign's video is not.
    return { removed: 0, failures: [`campaign verification failed: ${liveError.message}`] };
  }
  const stillLive = new Set((live ?? []).map((c) => c.id as string));
  const gone = ids.filter((id) => !stillLive.has(id));
  if (gone.length === 0) return { removed: 0, failures: [] };

  const paths = new Set<string>(gone.map((id) => `${id}.mp4`));
  for (const id of gone) {
    const { data: listed, error: listError } = await admin.storage
      .from(CAMPAIGN_VIDEOS_BUCKET)
      .list(id);
    if (listError) {
      failures.push(`storage folder ${id}: ${listError.message}`);
      continue;
    }
    for (const object of listed ?? []) paths.add(`${id}/${object.name}`);
  }

  if (paths.size === 0) return { removed: 0, failures };

  const { data: removed, error: removeError } = await admin.storage
    .from(CAMPAIGN_VIDEOS_BUCKET)
    .remove(Array.from(paths));
  if (removeError) failures.push(`storage remove: ${removeError.message}`);

  return { removed: removed?.length ?? 0, failures };
}
