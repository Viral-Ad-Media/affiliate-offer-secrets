/**
 * One-step undo for a blog post.
 *
 * A single snapshot, not a revision history. That's a deliberate scope choice: the snapshot exists
 * to make "Regenerate" safe to press — you can always get back the thing the model replaced — and
 * one step covers that completely. A full history is a different feature with its own list UI,
 * retention policy and storage cost, and building it to serve an undo button would be building the
 * wrong thing.
 *
 * Consequence worth stating plainly: regenerating twice loses the original. The UI says so, and
 * shows when the snapshot was taken, rather than letting someone assume otherwise.
 */

export type PostSnapshot = {
  title: string;
  content_md: string;
  html: string | null;
  excerpt: string | null;
  seo_title: string | null;
  seo_description: string | null;
};

/** The fields a revert restores. Deliberately excludes slug, status and publish date: undoing a
 *  rewrite should not silently unpublish a post or change its public URL. */
export function snapshotOf(post: Record<string, unknown>): PostSnapshot {
  return {
    title: String(post.title ?? ""),
    content_md: String(post.content_md ?? ""),
    html: (post.html as string | null) ?? null,
    excerpt: (post.excerpt as string | null) ?? null,
    seo_title: (post.seo_title as string | null) ?? null,
    seo_description: (post.seo_description as string | null) ?? null,
  };
}

/** Narrows a stored jsonb value back to a snapshot, or null if it isn't one. */
export function asSnapshot(v: unknown): PostSnapshot | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.content_md !== "string") return null;
  return snapshotOf(o);
}
