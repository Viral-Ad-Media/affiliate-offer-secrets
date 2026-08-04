import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const KNOWN_NETWORKS = ["clickbank", "digistore24"];
const MAX_SHORT = 200;
const MAX_LONG = 3000;

function clampStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}

// Accepts a finite, non-negative number within a sane ceiling; anything else becomes undefined so
// the column stays null rather than storing garbage.
function numeric(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return undefined;
  return n;
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const network = clampStr(body.network, 20);
  if (!KNOWN_NETWORKS.includes(network)) {
    return NextResponse.json({ error: "unknown network" }, { status: 400 });
  }

  const vendorId = clampStr(body.vendor_id, MAX_SHORT);
  const productTitle = clampStr(body.product_title, MAX_SHORT);
  if (!vendorId || !productTitle) {
    return NextResponse.json({ error: "product ID and title are required" }, { status: 400 });
  }

  const salesPageUrl = clampStr(body.sales_page_url, MAX_SHORT);
  if (salesPageUrl && !isHttpUrl(salesPageUrl)) {
    return NextResponse.json({ error: "sales page URL must be a valid http(s) URL" }, { status: 400 });
  }

  // Entitlement check mirrors app/api/jobs/route.ts and app/api/promote/route.ts — a client
  // shouldn't be able to add a product for a network they haven't connected an affiliate ID for,
  // since that product's hoplink would have nowhere real to point.
  const { data: connection } = await supabase
    .from("network_connections")
    .select("affiliate_id")
    .eq("workspace_id", ws)
    .eq("network", network)
    .maybeSingle();
  if (!connection?.affiliate_id) {
    return NextResponse.json(
      { error: `Connect your ${network} affiliate ID first` },
      { status: 400 }
    );
  }

  const meta = {
    network,
    vendor_id: vendorId,
    product_title: productTitle,
    niche: clampStr(body.niche, MAX_SHORT) || "unknown",
    description: clampStr(body.description, MAX_LONG) || undefined,
    sales_page_url: salesPageUrl || undefined,
    // Marketplace stats, when the caller has them — the Top/Trending panel adds straight from the
    // daily cache, and dropping these would show a brand-new row with no gravity or $/sale beside
    // products that have both. upsert_product already accepts them; only this route ignored them.
    // Still bounded: these arrive as request JSON, and a NaN or a negative would render as
    // nonsense on the dashboard.
    gravity: numeric(body.gravity),
    avg_sale: numeric(body.avg_sale),
    recurring: numeric(body.recurring),
    status: "New",
  };

  const { data: product, error } = await supabase.rpc("add_manual_product", { p_meta: meta });
  if (error) {
    return NextResponse.json({ error: "couldn't add product — check the details and try again" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, product });
}
