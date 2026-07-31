import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ContactImportPanel from "@/components/ContactImportPanel";

export const dynamic = "force-dynamic";

export default async function ContactImportPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: tags }, { data: campaigns }] = await Promise.all([
    supabase.from("contact_tags").select("id, name").eq("user_id", user.id).order("name"),
    supabase.from("campaigns").select("id, products(product_title)"),
  ]);

  return (
    <ContactImportPanel
      tags={tags ?? []}
      campaigns={(campaigns ?? [])
        .map((c: any) => ({ id: c.id, title: c.products?.product_title ?? "Untitled campaign" }))
        .sort((a, b) => a.title.localeCompare(b.title))}
    />
  );
}
