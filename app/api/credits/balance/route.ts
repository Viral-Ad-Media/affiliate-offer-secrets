import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// The workspace's current credit balance. Exists so a client component can refresh the number
// after spending without a full router.refresh() — the balance is the one piece of app chrome that
// changes as a direct result of clicking a button several components deep.
//
// Reads through the RLS-scoped client and the same workspace_credit_balance() function every debit
// path uses, so the number shown and the number a charge checks against can't drift.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ balance: 0 });

  const { data, error } = await supabase.rpc("workspace_credit_balance", { p_workspace_id: ws });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ balance: Number(data ?? 0) });
}
