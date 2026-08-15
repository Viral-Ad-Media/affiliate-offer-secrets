import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDomainFullyVerified, NetlifyApiError, provisionSsl } from "@/lib/netlify/client";
import { syncDomainAliases } from "@/lib/netlify/domains";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
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

  try {
    // Netlify has no ownership challenge to re-attempt — there is no per-domain endpoint at all —
    // so "verified" here means exactly one thing: the domain's DNS resolves to us right now.
    //
    // Reconcile first, because a domain that was added while Netlify was unreachable would
    // otherwise never be attached, and a certificate is only issued for attached names.
    await syncDomainAliases(admin).catch(() => null);
    const verified = await isDomainFullyVerified(domainRow.domain);
    // Best-effort: Netlify only issues once DNS resolves, so this failing means "not ready yet".
    if (verified) await provisionSsl().catch(() => null);

    const { data: updated, error: updateErr } = await admin
      .from("custom_domains")
      .update({
        status: verified ? "verified" : "pending",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", domainRow.id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: "This domain is already verified on another account." },
        { status: 409 }
      );
    }

    return NextResponse.json({ domain: updated });
  } catch (err) {
    const message = err instanceof NetlifyApiError ? err.message : "Failed to verify domain";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
