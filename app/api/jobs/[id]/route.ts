import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  // Authenticated table DELETE is intentionally revoked. The RPC permits terminal history only:
  // cancelling/refunding a pending row would enable a free queue/webhook/cancel loop, and a retry
  // may already have incurred provider cost.
  const { data: deleted, error } = await supabase.rpc("delete_job", {
    p_workspace_id: ws,
    p_job_id: params.id,
  });
  if (error) {
    const conflict = error.message.includes("Only completed jobs");
    return NextResponse.json(
      { error: conflict ? error.message : "Could not delete that job" },
      { status: conflict ? 409 : 500 }
    );
  }
  return NextResponse.json({ ok: true, deleted: deleted ? 1 : 0 });
}
