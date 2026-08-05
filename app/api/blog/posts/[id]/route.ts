import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_POST_TITLE, MAX_POST_EXCERPT, MAX_FEATURED_IMAGE_CHARS, blogRenderCtx, renderBlockTree, slugify } from "@/lib/blog";
import { validatePageBlockTree } from "@/lib/engine/validatePageBlockTree";
import { seoPatchFrom } from "@/lib/seo";
import { isValidImageDataUrl } from "@/lib/images/validate";

export const dynamic = "force-dynamic";

// Post slugs are unique per blog (0033's partial index). Rather than let a duplicate title 500
// on the index, append -2, -3, … until free. Excludes the post being edited so re-saving an
// unchanged title doesn't keep incrementing.
async function uniquePostSlug(workspaceId: string, postId: string, desired: string): Promise<string> {
  const admin = createAdminClient();
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? desired : `${desired}-${n}`;
    const { data } = await admin
      .from("blog_posts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("slug", candidate)
      .neq("id", postId)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${desired}-${postId.slice(0, 8)}`;
}

// Edit a post. Content arrives as a block tree (`blocks`, same shape the funnel page-copy routes
// take) and is validated with the "blog" profile — locked disclosure required, campaign-shaped
// locked blocks (lead form / CTA / decline) rejected — then rendered to html at write time, the
// same page_copy→html relationship campaigns.bridge_html has. Every write is scoped to
// (id, user_id) on the admin client — 0 rows updated means not-yours-or-nonexistent, generic 404.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.title === "string") {
    const title = body.title.trim().slice(0, MAX_POST_TITLE);
    if (!title) return NextResponse.json({ error: "title can't be empty" }, { status: 400 });
    patch.title = title;
  }
  if (Array.isArray(body.blocks)) {
    const result = validatePageBlockTree({ blocks: body.blocks, contentWidth: body.contentWidth }, { pageKind: "blog" });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    patch.page_copy = result.tree;
    patch.html = renderBlockTree(result.tree, blogRenderCtx());
  }
  if (typeof body.slug === "string" || typeof body.title === "string") {
    // Slug follows the title unless explicitly set. Uniqueness is per-blog (0033's partial index),
    // so a collision within this tenant gets a numeric suffix rather than a 500 from the index.
    const desired = slugify(typeof body.slug === "string" && body.slug.trim() ? body.slug : (patch.title as string) ?? "");
    if (desired) patch.slug = await uniquePostSlug(ws as string, params.id, desired);
  }
  if (typeof body.excerpt === "string") {
    patch.excerpt = body.excerpt.trim().slice(0, MAX_POST_EXCERPT) || null;
  }
  if (body.featured_image_url === null) {
    patch.featured_image_url = null;
    patch.featured_image_status = "none";
  } else if (typeof body.featured_image_url === "string") {
    if (!isValidImageDataUrl(body.featured_image_url, MAX_FEATURED_IMAGE_CHARS)) {
      return NextResponse.json({ error: "featured image must be a PNG/JPEG/WebP/GIF under the size cap" }, { status: 400 });
    }
    patch.featured_image_url = body.featured_image_url;
    patch.featured_image_status = "ready";
    patch.featured_image_error = null;
  }
  if (body.category_id === null) {
    patch.category_id = null;
  } else if (typeof body.category_id === "string") {
    // RLS-scoped read doubles as the ownership check — another tenant's category id is invisible.
    const { data: cat } = await supabase.from("blog_categories").select("id").eq("id", body.category_id).maybeSingle();
    if (!cat) return NextResponse.json({ error: "category not found" }, { status: 404 });
    patch.category_id = cat.id;
  }
  if ("seo_title" in body || "seo_description" in body) {
    Object.assign(patch, seoPatchFrom(body));
  }
  if (typeof body.seo_index === "boolean") patch.seo_index = body.seo_index;
  if (body.status === "draft" || body.status === "published") {
    patch.status = body.status;
    if (body.status === "published") patch.published_at = new Date().toISOString();
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_posts")
    .update(patch)
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id, title, status, category_id, published_at, updated_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, post: data[0] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const ws = await currentWorkspaceId();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_posts")
    .delete()
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
