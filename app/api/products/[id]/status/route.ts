import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_STATUSES } from "@/lib/shared";

export const dynamic = "force-dynamic";

// Set a product's pipeline status by hand (Selected / Paused / Dead — the ones the engine never
// writes on its own; it only ever sets "New" on discovery and "Promoting" when a kit finishes).
//
// Uses the RLS-scoped client deliberately, not the admin client: products' own policy
// (`for all using (auth.uid() = user_id)`) already scopes the write correctly, so an admin client
// here would only widen what a bug could reach. That's the opposite of `campaigns`, whose policy is
// select-only precisely because its HTML is served to real ad traffic.
//
// The enum check below is for a clear error message; migration 0048's CHECK constraint is the
// actual boundary, since this table is directly PATCH-able through PostgREST.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json().catch(() => ({}));
  const status = typeof body.status === "string" ? body.status : "";
  if (!(PRODUCT_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${PRODUCT_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("products")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id, status")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // No row means it isn't this tenant's product (or doesn't exist) — same generic answer either
  // way, no existence oracle.
  if (!data) return NextResponse.json({ error: "product not found" }, { status: 404 });

  return NextResponse.json({ ok: true, status: data.status });
}
