import { createAdminClient } from "./admin";

// Private bucket (supabase/migrations — created via execute_sql, storage.buckets has no dedicated
// migration DDL support) — `storage.objects` has zero RLS policies, same default-deny pattern as
// meta_pages/tiktok_connections, so only the service-role admin client can ever read or write an
// object directly. Clients only ever get a short-lived signed URL, minted fresh per use, never
// stored — see createSignedVideoUrl() below.
export const CAMPAIGN_VIDEOS_BUCKET = "campaign-videos";

export async function uploadCampaignVideo(path: string, bytes: Buffer, contentType: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(CAMPAIGN_VIDEOS_BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Failed to upload video to storage: ${error.message}`);
}

// Fresh signed URL, minted at the moment of use (e.g. right before a TikTok PULL_FROM_URL or
// Instagram Reels container call) — never persisted. Default 1-hour expiry is plenty for a
// same-request posting call.
export async function createSignedVideoUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(CAMPAIGN_VIDEOS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed video URL: ${error?.message ?? "no URL returned"}`);
  }
  return data.signedUrl;
}

export async function downloadCampaignVideo(path: string): Promise<Buffer> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(CAMPAIGN_VIDEOS_BUCKET).download(path);
  if (error || !data) throw new Error(`Failed to download video from storage: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}
