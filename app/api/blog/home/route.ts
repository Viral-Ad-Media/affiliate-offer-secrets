import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { blogRenderCtx, renderBlockTree } from "@/lib/blog";
import { validatePageBlockTree } from "@/lib/engine/validatePageBlockTree";

export const dynamic = "force-dynamic";

// Saves the blog home's intro band. Same shape as the post PATCH route: the client sends a block
// tree (never HTML), the server validates it and owns the render, and the write goes through the
// admin client because blog tables have no client write grants (0030).
//
// pageKind "blog" is reused rather than inventing a fourth validator profile — which means the
// intro carries the same locked affiliate disclosure a post does. That's the right default for a
// page whose whole purpose is linking to affiliate articles.
export async function PATCH(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const result = validatePageBlockTree({ blocks: body.blocks }, { pageKind: "blog" });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const html = renderBlockTree(result.tree, blogRenderCtx());

  const admin = createAdminClient();
  // Upsert: a tenant can write their home intro before they've saved any other blog setting.
  const { error } = await admin
    .from("blog_settings")
    .upsert(
      { user_id: user.id, intro_copy: result.tree, intro_html: html, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
