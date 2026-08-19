import { NETWORKS as NETWORK_CATALOGUE, type NetworkId } from "@/lib/networks";
import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// From the catalogue — see lib/networks.ts.
const KNOWN_NETWORKS = NETWORK_CATALOGUE.map((n) => n.id);
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
  if (!ws) return workspaceRequiredResponse();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Narrowed via the catalogue rather than cast: the value reaches the renderer's
  // switch, so "it's a string that looked fine" is not good enough.
  const network = clampStr(body.network, 20) as NetworkId;
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

  // The network_connections gate that used to sit here is gone with the affiliate-network panel:
  // the app no longer constructs links from an affiliate ID (content rule 4), so requiring one
  // before a product could be added blocked work the ID cannot affect — the same reasoning that
  // removed the identical gates from /api/jobs and /api/promote. The product's real link is
  // pasted per-product after its kit builds.

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
