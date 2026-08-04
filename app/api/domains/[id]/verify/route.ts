import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDomainFullyVerified, verifyProjectDomain, VercelApiError } from "@/lib/vercel/client";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

  const admin = createAdminClient();
  const { data: domainRow } = await admin
    .from("custom_domains")
    .select("id, domain")
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .single();
  if (!domainRow) return NextResponse.json({ error: "domain not found" }, { status: 404 });

  try {
    // Re-attempt the ownership-verification challenge (harmless no-op if already verified), then
    // re-check the actual DNS-pointing state — both must pass for our own status to say 'verified'.
    await verifyProjectDomain(domainRow.domain).catch(() => null);
    const verified = await isDomainFullyVerified(domainRow.domain);

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
    const message = err instanceof VercelApiError ? err.message : "Failed to verify domain";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
