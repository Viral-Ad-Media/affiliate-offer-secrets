// Turning stored data: URIs into hosted URLs, at the points that WRITE them. SERVER-ONLY — it
// imports ./client.ts (node:crypto) and the admin Supabase client.
//
// The write paths all already hold a data URI by the time they persist, so each one gains a single
// call here rather than being restructured. Nothing client-side changes: the editors keep posting
// a data URI to the same endpoints, and the endpoint is what uploads.

import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadImage, isCloudinaryConfigured } from "./client";


/** Where an asset lands in the Cloudinary console. Cosmetic — ownership lives in cloudinary_assets. */
export const CLD_FOLDER = {
  blog: "aos/blog",
  blogAuthor: "aos/blog-author",
  campaign: "aos/campaigns",
  creative: "aos/creatives",
  page: "aos/pages",
} as const;

export type AssetOwner = { workspaceId: string; userId: string };

/**
 * Uploads one image and records it, returning the delivery URL.
 *
 * Three pass-through cases, all deliberate:
 *   - already one of our URLs -> returned unchanged, so every caller is idempotent and a re-save
 *     never re-uploads the same bytes;
 *   - Cloudinary not configured -> the ORIGINAL value is returned, so a deployment without keys
 *     keeps working exactly as it did before this existed. This is the property that lets the
 *     integration ship without a flag day;
 *   - upload fails -> also the original value. A failed upload must not lose someone's image or
 *     fail their save; they end up with the pre-migration behaviour, which is a working page.
 *
 * The ledger insert is best-effort for the same reason — a missing row means one asset the deletion
 * sweep won't find, which is worth strictly less than the user's save succeeding. It is logged so
 * the gap is visible rather than silent, matching how createPostFromCampaign's failure was made
 * visible after being swallowed for months.
 */
export async function uploadImageRef(
  admin: SupabaseClient,
  value: string | null | undefined,
  folder: string,
  owner: AssetOwner
): Promise<string | null> {
  if (!value) return null;
  // Only inline bytes need uploading. Anything else — one of our Cloudinary URLs from a previous
  // save, or any other stored value — is returned untouched, which is what makes every caller
  // idempotent: re-saving a page never re-uploads an image that already moved.
  //
  // Checked by prefix rather than via isOwnCloudinaryUrl because that is a type predicate, and its
  // FALSE branch would narrow `value` to never — "not one of our URLs" does not mean "not a
  // string". The allowlist still guards what gets STORED; this only decides what gets uploaded.
  if (!value.startsWith("data:")) return value;
  if (!isCloudinaryConfigured()) return value;

  try {
    const asset = await uploadImage(value, { folder });
    const { error } = await admin.from("cloudinary_assets").insert({
      public_id: asset.publicId,
      workspace_id: owner.workspaceId,
      user_id: owner.userId,
      secure_url: asset.secureUrl,
      bytes: asset.bytes,
    });
    if (error) {
      console.error("[cloudinary] uploaded but failed to record asset", asset.publicId, error.message);
    }
    return asset.secureUrl;
  } catch (err) {
    console.error("[cloudinary] upload failed, keeping the inline image", (err as Error).message);
    return value;
  }
}

// Which block content paths hold an image. Kept beside the uploader rather than derived from the
// renderer, because a NEW image-bearing block type has to be added here consciously — a block whose
// image is missed here silently keeps inlining base64 and nothing fails.
type ImageSlot = { get: (b: any) => string | null | undefined; set: (b: any, v: string) => void };

const SLOTS: Record<string, ImageSlot[]> = {
  image: [{ get: (b) => b.content?.dataUrl, set: (b, v) => (b.content.dataUrl = v) }],
  navigation: [
    { get: (b) => b.content?.brandImageDataUrl, set: (b, v) => (b.content.brandImageDataUrl = v) },
  ],
  testimonial: [
    { get: (b) => (b.content?.media?.kind === "image" ? b.content.media.dataUrl : null), set: (b, v) => (b.content.media.dataUrl = v) },
  ],
};

/**
 * Uploads every inline image in a block tree, in place, and returns how many moved.
 *
 * Runs AFTER validatePageBlockTree so it only ever walks a tree that has already been rebuilt and
 * checked — it is not a validation step and must never become one. Both shapes stay legal
 * afterwards (isValidImageRef accepts either), so a partial upload leaves a page that still saves
 * and still renders.
 */
export async function uploadTreeImages(
  admin: SupabaseClient,
  tree: { blocks: unknown[] },
  folder: string,
  owner: AssetOwner
): Promise<number> {
  if (!isCloudinaryConfigured()) return 0;
  let moved = 0;

  const swap = async (get: () => string | null | undefined, set: (v: string) => void) => {
    const current = get();
    if (!current || !current.startsWith("data:")) return;
    const url = await uploadImageRef(admin, current, folder, owner);
    if (url && url !== current) {
      set(url);
      moved++;
    }
  };

  const walk = async (blocks: unknown[]): Promise<void> => {
    for (const raw of blocks) {
      const b = raw as any;
      if (!b || typeof b !== "object") continue;

      for (const slot of SLOTS[b.type as string] ?? []) {
        await swap(() => slot.get(b), (v) => slot.set(b, v));
      }
      // Array-shaped slots, handled separately because the setter needs the index.
      if (b.type === "image_list" && Array.isArray(b.content?.items)) {
        for (const item of b.content.items) {
          await swap(() => item.imageDataUrl, (v) => (item.imageDataUrl = v));
        }
      }
      if (b.type === "carousel" && Array.isArray(b.content?.slides)) {
        for (const slide of b.content.slides) {
          await swap(() => slide.imageDataUrl, (v) => (slide.imageDataUrl = v));
        }
      }

      if (Array.isArray(b.children)) await walk(b.children);
      if (Array.isArray(b.columns)) await walk(b.columns);
    }
  };

  await walk(tree.blocks);
  return moved;
}
