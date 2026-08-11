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

// Same-workspace membership for both the domain and campaign is enforced inside add_domain_route;
// composite database FKs preserve that relationship for every writer. This route remains a thin
// input-normalizing pass-through, not the security boundary.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const path = normalizePath(body.path);
  const campaignId = String(body.campaign_id ?? "");

  if (!campaignId || !PATH_RE.test(path)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { data: routeId, error } = await supabase.rpc("add_domain_route", {
    p_domain_id: params.id,
    p_path: path,
    p_campaign_id: campaignId,
    // Always "bridge" — the presell page variant was merged into it (lib/engine/renderPages.ts).
    // Not exposed as caller input anymore; add_domain_route()/custom_domain_routes.destination
    // keep the legacy 'presell' check-constraint option (no live rows use it).
    p_destination: "bridge",
  });

  if (error) {
    return NextResponse.json({ error: error.message || "Could not create route" }, { status: 400 });
  }

  return NextResponse.json({ id: routeId });
}
