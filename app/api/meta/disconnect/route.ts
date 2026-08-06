import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  // Disconnects the workspace's connection, not "the one this person happened to create" — a
  // teammate must be able to unhook a bad connection without the original connector present.
  // Passing null would not fall back usefully: the RPC's own default is current_workspace_id(),
  // which is exactly what already answered null here.
  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const { error } = await supabase.rpc("disconnect_meta", { p_workspace_id: ws });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
