import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// CSV of EVERY contact, not just the page on screen. The table used to hold up to 1000 rows
// client-side and built the file from that array; once the page was paginated, that would silently
// have exported 50 rows and called it an export. Exporting is the main reason this data is here at
// all (getting leads into an ESP), so it gets a real server-side route.

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Same flattening the table shows — one column for user-added form fields, since the field set
// varies per campaign and changes as a tenant edits their form.
function flattenExtraFields(extra: Record<string, string> | null): string {
  return Object.entries(extra ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

// Paged read: one query per 1000 rows rather than a single unbounded fetch, so a big list can't
// blow the response together in memory before a byte is written.
const PAGE = 1000;
const MAX_ROWS = 50_000;

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: campaigns } = await supabase.from("campaigns").select("id, products(product_title)");
  const titleByCampaign = new Map<string, string>();
  for (const c of campaigns ?? []) {
    const title = (c as any).products?.product_title;
    if (title) titleByCampaign.set(c.id as string, title);
  }

  const lines = ["First name,Email,Campaign,Extra fields,Captured at"];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data: rows } = await supabase
      .from("contacts")
      .select("campaign_id, first_name, email, extra_fields, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      lines.push(
        [
          csvField((r.first_name as string) ?? ""),
          csvField(r.email as string),
          csvField(r.campaign_id ? (titleByCampaign.get(r.campaign_id as string) ?? "") : ""),
          csvField(flattenExtraFields(r.extra_fields as Record<string, string> | null)),
          csvField(r.created_at as string),
        ].join(",")
      );
    }
    if (rows.length < PAGE) break;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
