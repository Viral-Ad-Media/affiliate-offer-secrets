import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/lib/shared";
import ContactsTable from "@/components/ContactsTable";
import ContactErasePanel from "@/components/ContactErasePanel";
import Pager, { PAGE_SIZE, pageFromParam, pageRange } from "@/components/Pager";

// Real paid traffic accumulates leads fast — this list was capped at 1000 with no way to reach
// anything past it. Now paged, so the whole table is reachable and each page is one bounded query.
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();

  const { count } = await supabase
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws);
  const total = count ?? 0;
  const page = pageFromParam(searchParams.page, Math.ceil(total / PAGE_SIZE));
  const [from, to] = pageRange(page);

  const [{ data: rows }, { data: campaigns }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, campaign_id, first_name, email, extra_fields, created_at")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .range(from, to),
    supabase.from("campaigns").select("id, products(product_title)"),
  ]);

  const titleByCampaign = new Map<string, string>();
  for (const c of campaigns ?? []) {
    const title = (c as any).products?.product_title;
    if (title) titleByCampaign.set(c.id, title);
  }

  const contacts: Contact[] = (rows ?? []).map((r) => ({
    id: r.id,
    campaign_id: r.campaign_id,
    campaign_title: r.campaign_id ? (titleByCampaign.get(r.campaign_id) ?? null) : null,
    first_name: r.first_name,
    email: r.email,
    extra_fields: (r.extra_fields as Record<string, string>) ?? {},
    created_at: r.created_at,
  }));

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Contacts</h1>
        <p className="text-sm text-zinc-400">
          Leads captured from your bridge pages' opt-in forms.
        </p>
      </header>
      <ContactsTable contacts={contacts} />
      <Pager page={page} total={total} basePath="/contacts" label="contacts" />
      <ContactErasePanel />
    </main>
  );
}
