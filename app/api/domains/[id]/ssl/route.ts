import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { checkCertificate } from "@/lib/netlify/ssl";

export const dynamic = "force-dynamic";

/**
 * Reads the certificate currently served for one of this workspace's domains.
 *
 * On demand rather than on page load: it is a TLS handshake per domain, and a tenant with a dozen
 * domains shouldn't pay twelve of them every time they open Settings.
 *
 * Scoped to a domain row the caller's workspace owns, and the domain string comes from THAT ROW —
 * never from the request. Taking a hostname from the body would turn this into a scanner that
 * opens outbound connections to anything a caller names.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("custom_domains")
    .select("domain")
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "domain not found" }, { status: 404 });

  return NextResponse.json(await checkCertificate(row.domain));
}
