import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadImageRef, CLD_FOLDER } from "@/lib/cloudinary/upload";
import { isValidImageDataUrl, MAX_AD_IMAGE_DATA_URL_CHARS } from "@/lib/images/validate";
import { CAMPAIGN_VIDEOS_BUCKET } from "@/lib/supabase/storage";

export const dynamic = "force-dynamic";

// Bring-your-own creative for an ad angle / social post / TikTok script — the upload sibling of
// /api/campaign-creatives/generate, writing the SAME campaign_creatives row the generation jobs
// do, so LaunchAd/AdPreview/posting flows read an uploaded creative exactly like a generated one.
//
// Images arrive as a resized data URL in the JSON body (the editors' existing shape) and are
// hosted on Cloudinary before the row stores them. Videos are too big for a function body, so
// they take two steps: "sign" mints a Supabase Storage signed-upload URL for the SERVER-derived
// per-item path — the client never chooses a path — the browser PUTs the bytes straight to
// Storage, and "confirm" verifies the object exists before stamping the row. Both steps re-run
// the full ownership validation; a signed URL is not a capability to write rows.
const KNOWN_SOURCES = ["fb_ad_angle", "social_post", "tiktok_script"] as const;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json().catch(() => ({}));
  const campaignId = body.campaign_id as string | undefined;
  const source = body.source as string | undefined;
  const kind = body.kind as string | undefined;
  const itemIndex = Number(body.item_index);

  if (
    !campaignId ||
    !KNOWN_SOURCES.includes(source as any) ||
    (kind !== "image" && kind !== "video") ||
    !Number.isInteger(itemIndex) ||
    itemIndex < 0
  ) {
    return NextResponse.json({ error: "Missing or invalid request fields" }, { status: 400 });
  }

  // RLS-scoped read is the ownership check, the generate route's idiom — another tenant's
  // campaign is simply not visible. The bounds check mirrors it too: an uploaded creative for an
  // item that doesn't exist would render nowhere and confuse every consumer that indexes by item.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("fb_ad_angles, social_posts, tiktok_scripts")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const items =
    source === "fb_ad_angle"
      ? (campaign.fb_ad_angles as unknown[] | null)
      : source === "social_post"
        ? (campaign.social_posts as unknown[] | null)
        : (campaign.tiktok_scripts as unknown[] | null);
  if (!items || itemIndex >= items.length) {
    return NextResponse.json({ error: `No ${source} at index ${itemIndex}` }, { status: 400 });
  }

  const admin = createAdminClient();

  // A generation in flight owns the row until it finishes — an upload landing mid-job would be
  // silently overwritten by the job's own finalize, which reads as the upload "not taking".
  const { data: existing } = await admin
    .from("campaign_creatives")
    .select("id, status")
    .eq("campaign_id", campaignId)
    .eq("source", source)
    .eq("item_index", itemIndex)
    .eq("kind", kind)
    .maybeSingle();
  if (existing?.status === "generating") {
    return NextResponse.json(
      { error: "A generation is already running for this slot — wait for it to finish first" },
      { status: 409 }
    );
  }

  async function writeRow(patch: Record<string, unknown>) {
    const { error } = await admin.from("campaign_creatives").upsert(
      {
        campaign_id: campaignId,
        workspace_id: ws,
        user_id: user!.id,
        source,
        item_index: itemIndex,
        kind,
        status: "ready",
        error: null,
        model: "uploaded",
        updated_at: new Date().toISOString(),
        ...patch,
      },
      { onConflict: "campaign_id,source,item_index,kind" }
    );
    return error;
  }

  if (kind === "image") {
    const dataUrl = body.image_data_url;
    if (typeof dataUrl !== "string" || !isValidImageDataUrl(dataUrl, MAX_AD_IMAGE_DATA_URL_CHARS)) {
      return NextResponse.json(
        { error: "That image is too large or not a supported format (png/jpeg/webp/gif)" },
        { status: 400 }
      );
    }
    const hosted =
      (await uploadImageRef(admin, dataUrl, CLD_FOLDER.creative, { workspaceId: ws, userId: user.id })) ?? dataUrl;
    const error = await writeRow({ image_data_url: hosted, video_path: null });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // kind === "video": two-step. The path is derived here BOTH times — the per-item shape the
  // storage sweep already knows how to collect — never taken from the request.
  const path = `${campaignId}/${source}-${itemIndex}.mp4`;

  if (body.action === "sign") {
    const size = Number(body.size);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: "Video must be an mp4 under 100 MB" }, { status: 400 });
    }
    // Remove any previous object first: a signed upload URL refuses to overwrite, and "replace my
    // creative" is exactly what a re-upload means.
    await admin.storage.from(CAMPAIGN_VIDEOS_BUCKET).remove([path]);
    const { data, error } = await admin.storage.from(CAMPAIGN_VIDEOS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? "Could not prepare the upload" }, { status: 500 });
    }
    return NextResponse.json({ path: data.path, token: data.token });
  }

  if (body.action === "confirm") {
    // The object must really exist before the row claims a video lives there — a row pointing at
    // nothing would strand every consumer that mints signed URLs from it.
    const { data: listed } = await admin.storage
      .from(CAMPAIGN_VIDEOS_BUCKET)
      .list(campaignId, { search: `${source}-${itemIndex}.mp4` });
    if (!listed?.some((o) => o.name === `${source}-${itemIndex}.mp4`)) {
      return NextResponse.json({ error: "Upload not found — try again" }, { status: 400 });
    }
    const error = await writeRow({ video_path: path, image_data_url: null });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown video action" }, { status: 400 });
}
