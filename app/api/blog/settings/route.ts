import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_BLOG_SETTING,
  MAX_BLOG_BIO,
  MAX_FEATURED_IMAGE_CHARS,
  MIN_TOC_HEADINGS,
  MAX_TOC_HEADINGS,
  slugify,
  isPermalinkStyle,
} from "@/lib/blog";
import { isValidImageRef } from "@/lib/images/validate";
import { uploadImageRef, CLD_FOLDER } from "@/lib/cloudinary/upload";

export const dynamic = "force-dynamic";

// Reserved so a blog slug can never shadow a real /b/* behaviour or read as a post id.
const RESERVED_SLUGS = new Set(["api", "b", "p", "d", "admin", "static", "_next", "assets"]);

// Upsert the caller's blog settings — public identity (slug, title, description) plus the author
// byline/bio/avatar shown on the index and every post. One row per user, keyed by the live
// session's uid; there is no client-suppliable tenant field.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  // Resolved rather than left to the stamp_workspace_id trigger. This route writes on the admin
  // client, where auth.uid() is NULL, so the trigger's fallback is "this user's FIRST owned
  // workspace" — which files a second workspace's asset under the first. CLAUDE.md records the
  // same trap firing for real in the Meta callback and in POST /api/domains.
  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json().catch(() => ({}));
  const clean = (v: unknown, max = MAX_BLOG_SETTING) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {
    user_id: user.id,
    blog_title: clean(body.blog_title),
    author_name: clean(body.author_name),
    description: clean(body.description, 300),
    author_bio: clean(body.author_bio, MAX_BLOG_BIO),
    updated_at: new Date().toISOString(),
  };

  // Table of contents (0069). Clamped rather than rejected: these are a checkbox and a small
  // number picker, so an out-of-range value means a stale client, not a person to correct.
  if ("toc_enabled" in body) patch.toc_enabled = body.toc_enabled === true;
  if ("toc_title" in body) patch.toc_title = clean(body.toc_title, 60);
  if ("toc_min_headings" in body) {
    const n = Number(body.toc_min_headings);
    patch.toc_min_headings = Number.isFinite(n)
      ? Math.min(MAX_TOC_HEADINGS, Math.max(MIN_TOC_HEADINGS, Math.round(n)))
      : 3;
  }

  // Permalink structure (0044). Only set when the body names a known style — an unrecognized value
  // is ignored rather than 400ing, so an older client can keep saving the rest of the form.
  if (isPermalinkStyle(body.permalink_style)) patch.permalink_style = body.permalink_style;

  // Slug is the public handle in /b/{slug} and is globally unique (0033) — validate, reserve-check
  // and collision-check before writing so the tenant gets a clear message instead of a 500.
  if ("slug" in body) {
    const raw = clean(body.slug, 80);
    if (raw === null) {
      patch.slug = null;
    } else {
      const slug = slugify(raw);
      if (!slug) return NextResponse.json({ error: "That blog address isn't usable — try letters and numbers" }, { status: 400 });
      if (RESERVED_SLUGS.has(slug)) return NextResponse.json({ error: `"${slug}" is reserved — pick another` }, { status: 400 });
      const { data: taken } = await admin
        .from("blog_settings")
        .select("user_id")
        .ilike("slug", slug)
        .neq("user_id", user.id)
        .maybeSingle();
      if (taken) return NextResponse.json({ error: `"${slug}" is already taken — pick another` }, { status: 409 });
      patch.slug = slug;
    }
  }

  if (body.author_avatar_url === null) {
    patch.author_avatar_url = null;
  } else if (typeof body.author_avatar_url === "string") {
    if (!isValidImageRef(body.author_avatar_url, MAX_FEATURED_IMAGE_CHARS)) {
      return NextResponse.json({ error: "avatar must be a PNG/JPEG/WebP/GIF under the size cap" }, { status: 400 });
    }
    // Validated first, then hosted — the avatar renders under every post and at the foot of
    // the index, so it is on every blog page load.
    patch.author_avatar_url = await uploadImageRef(
      createAdminClient(),
      body.author_avatar_url,
      CLD_FOLDER.blogAuthor,
      { workspaceId: ws, userId: user.id }
    );
  }

  const { data, error } = await admin
    .from("blog_settings")
    .upsert(patch, { onConflict: "user_id" })
    .select("blog_title, author_name, slug, description, author_bio, author_avatar_url")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, settings: data });
}
