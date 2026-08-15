import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncDomainAliases } from "@/lib/netlify/domains";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const admin = createAdminClient();
  const { data: domainRow } = await admin
    .from("custom_domains")
    .select("id, domain")
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .single();
  if (!domainRow) return NextResponse.json({ error: "domain not found" }, { status: 404 });

  // Row first, then reconcile — the same ordering the add path uses, for the same reason: the
  // table is the authority and Netlify's alias list is derived from it. Detaching remotely first
  // and then failing to delete the row would leave the app believing it serves a domain it no
  // longer has.
  //
  // custom_domain_routes cascades on domain_id, so mapped paths are cleaned up automatically.
  await admin.from("custom_domains").delete().eq("id", domainRow.id);

  // Not fatal. The row is already gone and the domain no longer resolves here as far as this app
  // is concerned; a stale alias left on the site is corrected by the next reconcile, including the
  // 6-hourly cron. Reporting a failure now would invite a retry against a row that no longer exists.
  try {
    await syncDomainAliases(admin);
  } catch (err) {
    console.error("[domains] deleted the row but could not sync Netlify aliases", (err as Error).message);
  }

  return NextResponse.json({ ok: true });
}

// Flip this domain's role flags: serves_blog (which domain the blog is published on) and
// is_primary (which domain the app treats as this tenant's public home). Both are one-per-tenant
// — enforced by partial unique indexes in 0042 — so setting one clears the same flag on every
// other domain first. Both writes are (id, user_id)-scoped, same as DELETE above.
//
// Only a verified domain can hold either flag: an unverified one isn't serving traffic yet, and
// the 0042 trigger clears both if a domain later drops out of 'verified' (the reverify sweep can
// do that at any time).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json().catch(() => ({}));
  const patch: { serves_blog?: boolean; is_primary?: boolean } = {};
  if (typeof body.serves_blog === "boolean") patch.serves_blog = body.serves_blog;
  if (typeof body.is_primary === "boolean") patch.is_primary = body.is_primary;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: domainRow } = await admin
    .from("custom_domains")
    .select("id, status")
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!domainRow) return NextResponse.json({ error: "domain not found" }, { status: 404 });
  if (domainRow.status !== "verified" && (patch.serves_blog || patch.is_primary)) {
    return NextResponse.json(
      { error: "Verify this domain before using it for your blog or as your primary domain" },
      { status: 409 }
    );
  }

  // Clear first, then set — the partial unique indexes would reject the set otherwise. Two
  // statements rather than one, so a crash between them leaves NO domain holding the flag (a
  // recoverable state the UI shows plainly) instead of two domains holding it.
  for (const flag of ["serves_blog", "is_primary"] as const) {
    if (patch[flag] === true) {
      await admin
        .from("custom_domains")
        .update({ [flag]: false })
        .eq("workspace_id", ws)
        .neq("id", domainRow.id)
        .eq(flag, true);
    }
  }

  const { error } = await admin
    .from("custom_domains")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", domainRow.id)
    .eq("workspace_id", ws);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
