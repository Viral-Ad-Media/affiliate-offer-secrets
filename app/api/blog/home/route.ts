import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  blogRenderCtx,
  renderBlockTree,
  isBlogIndexLayout,
  MIN_INDEX_COLUMNS,
  MAX_INDEX_COLUMNS,
  MIN_INDEX_ROWS,
  MAX_INDEX_ROWS,
} from "@/lib/blog";
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
  const result = validatePageBlockTree({ blocks: body.blocks, contentWidth: body.contentWidth }, { pageKind: "blog" });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const html = renderBlockTree(result.tree, blogRenderCtx());

  // Post-list layout. Rejected rather than clamped: unlike a stored value that might predate a
  // bound change (which indexLayout() clamps on read), a request naming layout "masonry" or 9
  // columns is a client that has the wrong idea, and silently saving something else would leave
  // the UI showing a setting the server didn't take.
  const patch: Record<string, unknown> = {
    user_id: user.id,
    intro_copy: result.tree,
    intro_html: html,
    updated_at: new Date().toISOString(),
  };
  if (body.index_layout !== undefined) {
    if (!isBlogIndexLayout(body.index_layout)) {
      return NextResponse.json({ error: "layout must be grid or list" }, { status: 400 });
    }
    patch.index_layout = body.index_layout;
  }
  const bounded = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
  if (body.index_columns !== undefined) {
    if (!bounded(body.index_columns, MIN_INDEX_COLUMNS, MAX_INDEX_COLUMNS)) {
      return NextResponse.json(
        { error: `columns must be a whole number from ${MIN_INDEX_COLUMNS} to ${MAX_INDEX_COLUMNS}` },
        { status: 400 }
      );
    }
    patch.index_columns = body.index_columns;
  }
  if (body.index_rows !== undefined) {
    if (!bounded(body.index_rows, MIN_INDEX_ROWS, MAX_INDEX_ROWS)) {
      return NextResponse.json(
        { error: `rows must be a whole number from ${MIN_INDEX_ROWS} to ${MAX_INDEX_ROWS}` },
        { status: 400 }
      );
    }
    patch.index_rows = body.index_rows;
  }

  const admin = createAdminClient();
  // Upsert: a tenant can write their home intro before they've saved any other blog setting.
  const { error } = await admin.from("blog_settings").upsert(patch, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
