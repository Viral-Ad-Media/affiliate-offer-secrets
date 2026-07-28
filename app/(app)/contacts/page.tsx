import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/lib/shared";
import ContactsTable from "@/components/ContactsTable";

const MAX_CONTACTS = 1000;

export default async function ContactsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: rows }, { data: campaigns }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, campaign_id, first_name, email, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_CONTACTS),
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
    </main>
  );
}
