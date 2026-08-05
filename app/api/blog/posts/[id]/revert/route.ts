import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asSnapshot, snapshotOf } from "@/lib/blogRevision";

export const dynamic = "force-dynamic";

/**
 * Restore the snapshot taken before the last regeneration.
 *
 * Swaps rather than discards: the version being replaced becomes the new snapshot, so revert is
 * itself undoable. Without that, clicking revert by mistake would destroy the regenerated copy
 * with no way back — which is the same trap the snapshot exists to avoid in the first place.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const { data: post } = await supabase
    .from("blog_posts")
    .select("id, title, content_md, html, excerpt, seo_title, seo_description, previous_version")
    .eq("id", params.id)
    .maybeSingle();
  if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });

  const snapshot = asSnapshot(post.previous_version);
  if (!snapshot) return NextResponse.json({ error: "Nothing to revert to" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("blog_posts")
    .update({
      ...snapshot,
      // The swap: what we're replacing becomes the thing revert would restore next.
      previous_version: snapshotOf(post),
      previous_saved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("workspace_id", ws);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, restored: snapshot });
}
