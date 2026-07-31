import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_BLOG_SETTING, MAX_BLOG_BIO, MAX_FEATURED_IMAGE_CHARS, slugify } from "@/lib/blog";
import { isValidImageDataUrl } from "@/lib/images/validate";

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
    if (!isValidImageDataUrl(body.author_avatar_url, MAX_FEATURED_IMAGE_CHARS)) {
      return NextResponse.json({ error: "avatar must be a PNG/JPEG/WebP/GIF under the size cap" }, { status: 400 });
    }
    patch.author_avatar_url = body.author_avatar_url;
  }

  const { data, error } = await admin
    .from("blog_settings")
    .upsert(patch, { onConflict: "user_id" })
    .select("blog_title, author_name, slug, description, author_bio, author_avatar_url")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, settings: data });
}
