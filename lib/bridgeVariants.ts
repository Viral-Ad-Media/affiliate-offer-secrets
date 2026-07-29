// Shared between lib/publicPage.ts (assigns + reads the sticky cookie) and
// app/api/public/leads/route.ts (only ever reads it, to attribute a captured lead) — one place
// owns the cookie name/flags so the two call sites can never drift apart.

export type WeightedVariant = { id: string; weight: number };

function cookieName(campaignId: string): string {
  return `bv_${campaignId}`;
}

// Cumulative-weight pick — pure function, no I/O, easy to reason about independent of the caller.
export function pickWeightedVariant<T extends WeightedVariant>(variants: T[]): T {
  const total = variants.reduce((sum, v) => sum + v.weight, 0);
  let roll = Math.random() * total;
  for (const v of variants) {
    roll -= v.weight;
    if (roll < 0) return v;
  }
  return variants[variants.length - 1];
}

// Cookie header isn't parsed by any framework helper here — lib/publicPage.ts returns a plain
// Response (not NextResponse), matching the shape both app/p/[campaignId]/bridge/route.ts and
// app/d/[[...path]]/route.ts already pass through.
export function readStickyVariantId(req: Request, campaignId: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const name = cookieName(campaignId);
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// 30-day stickiness — a return visitor keeps seeing the same variant so the post-opt-in "reveal"
// step and any repeat-visit behavior stay consistent, and so lead attribution isn't skewed by a
// single visitor bouncing between variants across sessions. HttpOnly (nothing client-side ever
// needs to read this), SameSite=Lax + Secure-in-production matching the exact flag convention
// app/api/meta/connect/route.ts already uses for its OAuth state cookie.
export function buildStickyVariantCookie(campaignId: string, variantId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${cookieName(campaignId)}=${variantId}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secure}`;
}
