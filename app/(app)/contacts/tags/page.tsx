import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ContactTagsPanel from "@/components/ContactTagsPanel";

export const dynamic = "force-dynamic";

// Static segment, shadowing nothing — /contacts has no [id] route, but the name is reserved here
// the same way /blog/categories is.
export default async function ContactTagsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: ws } = await supabase.rpc("current_workspace_id");

  const [{ data: tags }, { data: links }] = await Promise.all([
    supabase.from("contact_tags").select("id, name").eq("workspace_id", ws).order("name"),
    supabase.from("contact_tag_links").select("tag_id").eq("workspace_id", ws),
  ]);

  const counts = new Map<string, number>();
  for (const l of links ?? []) counts.set(l.tag_id, (counts.get(l.tag_id) ?? 0) + 1);

  return (
    <ContactTagsPanel
      tags={(tags ?? []).map((t) => ({ id: t.id, name: t.name, contactCount: counts.get(t.id) ?? 0 }))}
    />
  );
}
