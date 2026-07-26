import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PATH_RE = /^[a-z0-9-_/]*$/;

function normalizePath(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
}

// Ownership of both the domain and the campaign is enforced inside the add_domain_route RPC
// (supabase/migrations/0009_page_domains.sql), keyed off auth.uid() — this route is a thin
// pass-through, not the actual security boundary.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const path = normalizePath(body.path);
  const campaignId = String(body.campaign_id ?? "");
  const destination =
    body.destination === "bridge" ? "bridge" : body.destination === "presell" ? "presell" : null;

  if (!campaignId || !destination || !PATH_RE.test(path)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { data: routeId, error } = await supabase.rpc("add_domain_route", {
    p_domain_id: params.id,
    p_path: path,
    p_campaign_id: campaignId,
    p_destination: destination,
  });

  if (error) {
    return NextResponse.json({ error: error.message || "Could not create route" }, { status: 400 });
  }

  return NextResponse.json({ id: routeId });
}
