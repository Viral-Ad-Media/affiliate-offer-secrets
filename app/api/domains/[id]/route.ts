import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { removeDomainFromProject, VercelApiError } from "@/lib/vercel/client";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const admin = createAdminClient();
  const { data: domainRow } = await admin
    .from("custom_domains")
    .select("id, domain")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  if (!domainRow) return NextResponse.json({ error: "domain not found" }, { status: 404 });

  try {
    await removeDomainFromProject(domainRow.domain);
  } catch (err) {
    if (!(err instanceof VercelApiError && err.status === 404)) {
      const message = err instanceof VercelApiError ? err.message : "Failed to remove domain";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  // custom_domain_routes cascades on domain_id, so mapped paths are cleaned up automatically.
  await admin.from("custom_domains").delete().eq("id", domainRow.id);
  return NextResponse.json({ ok: true });
}
