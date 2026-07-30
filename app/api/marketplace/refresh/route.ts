import { NextResponse } from "next/server";
import { refreshMarketplaceCache } from "@/lib/engine/marketplaceCache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Refreshes the shared marketplace_products preload cache (see lib/engine/marketplaceCache.ts).
// Called by pg_cron only ('marketplace-refresh-backstop', daily — cron.schedule applied
// separately via execute_sql, never committed) — same shared-secret, fail-closed shape as
// /api/engine/run and /api/broadcast/sweep, reusing the same ENGINE_WEBHOOK_SECRET. Dev
// workaround (pg_net can't reach localhost): curl -X POST localhost:3400/api/marketplace/refresh
// -H "x-engine-secret: $ENGINE_WEBHOOK_SECRET".
export async function POST(req: Request) {
  const secret = req.headers.get("x-engine-secret");
  if (!secret || secret !== process.env.ENGINE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshMarketplaceCache();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
