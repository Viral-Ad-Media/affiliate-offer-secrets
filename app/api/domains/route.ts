import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDomainFullyVerified, NetlifyApiError } from "@/lib/netlify/client";
import { syncDomainAliases } from "@/lib/netlify/domains";

export const dynamic = "force-dynamic";

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/;

function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!DOMAIN_RE.test(d)) return null;
  return d;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  // Every OTHER domain route already scopes by workspace; this one didn't, and it is the one that
  // creates the row. Because the insert below runs on the admin client (auth.uid() is null there),
  // stamp_workspace_id()'s fallback would file the domain under this user's FIRST OWNED workspace
  // — so someone in two workspaces adding a domain from workspace B got it filed under A, where
  // their teammates in B could never see it. Same trap CLAUDE.md documents for Meta's callback.
  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json().catch(() => ({}));
  const domain = normalizeDomain(String(body.domain ?? ""));
  if (!domain) {
    return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Re-adding a domain this workspace already holds returns the EXISTING row instead of inserting
  // a duplicate claim. Cross-tenant duplicate pending claims are by design (ownership is proven by
  // DNS, and a squatter's abandoned claim must not block the real owner) — but a second claim in
  // the SAME workspace is never useful, and it produced a real dead end: the domain was already
  // verified and serving five funnels, someone added it again from the panel, and pressing Verify
  // on the fresh pending row collided with their own verified one — surfacing as "already verified
  // on another account", which reads as someone else squatting your live domain.
  const { data: existing } = await admin
    .from("custom_domains")
    .select()
    .eq("workspace_id", ws)
    .eq("domain", domain)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ domain: existing, verification: [], existed: true });
  }

  try {
    // The ROW goes in first, then Netlify is reconciled from the table. Reversed — attach remotely,
    // then insert — a failed insert would leave an alias on the site that nothing in this app knows
    // about, and nothing would ever clean it up. This order means the database is always the
    // authority and the remote list is derived from it.
    const { data: row, error: insertErr } = await admin
      .from("custom_domains")
      .insert({
        user_id: user.id,
        // Explicit, never left to the trigger — see the comment above.
        workspace_id: ws,
        domain,
        // Always pending at first. Netlify has no ownership challenge to answer; a domain is
        // verified here only once its DNS actually resolves to us, which it cannot yet.
        status: "pending",
      })
      .select()
      .single();

    if (insertErr) {
      // Most likely the partial unique index — someone else already holds the verified claim.
      return NextResponse.json(
        { error: "This domain is already connected on another account." },
        { status: 409 }
      );
    }

    await syncDomainAliases(admin);

    // Usually false right now, and that is the normal path rather than a failure: the tenant has
    // not pointed their DNS yet. The UI shows the records to add and they press Verify after.
    const verified = await isDomainFullyVerified(domain);
    if (verified) {
      // CHECK the error: this update can legitimately fail on the one-verified-claim-per-domain
      // partial unique index (another tenant holds the verified claim while this DNS check passes —
      // e.g. mid-transfer). Unchecked, the row silently stayed pending while the response claimed
      // verified, and the panel then disagreed with the toast.
      const { error: verifyErr } = await admin
        .from("custom_domains")
        .update({ status: "verified" })
        .eq("id", row.id);
      if (!verifyErr) row.status = "verified";
    }

    return NextResponse.json({ domain: row, verification: [] });
  } catch (err) {
    const message = err instanceof NetlifyApiError ? err.message : "Failed to add domain";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
