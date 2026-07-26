import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { routeId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { error } = await supabase.rpc("remove_domain_route", { p_route_id: params.routeId });
  if (error) {
    return NextResponse.json({ error: error.message || "Could not remove route" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
