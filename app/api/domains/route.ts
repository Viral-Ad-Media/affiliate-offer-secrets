import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDomainToProject, isDomainFullyVerified, VercelApiError } from "@/lib/vercel/client";

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

  const body = await req.json().catch(() => ({}));
  const domain = normalizeDomain(String(body.domain ?? ""));
  if (!domain) {
    return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    const result = await addDomainToProject(domain);
    const verified = result.verified && (await isDomainFullyVerified(domain));

    const { data: row, error: insertErr } = await admin
      .from("custom_domains")
      .insert({
        user_id: user.id,
        domain,
        status: verified ? "verified" : "pending",
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

    return NextResponse.json({ domain: row, verification: result.verification });
  } catch (err) {
    const message = err instanceof VercelApiError ? err.message : "Failed to add domain";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
