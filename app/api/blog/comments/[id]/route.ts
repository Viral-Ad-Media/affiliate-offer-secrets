import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const STATUSES = ["approved", "pending", "spam"] as const;

/**
 * Moderate one comment. Writes on the admin client (blog_comments has no client write grants),
 * so the id — caller-supplied — is re-resolved against the caller's workspace first, the same
 * non-negotiable shape as every bulk route. Approving is the ONLY path by which a stranger's text
 * reaches a public page, which is why there is no bulk-approve: each one deserves a look.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json().catch(() => ({}));
  const status = body.status as (typeof STATUSES)[number];
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: "unknown status" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_comments")
    .update({ status })
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, status });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_comments")
    .delete()
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
