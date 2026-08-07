import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import ContactTagsPanel from "@/components/ContactTagsPanel";

export const dynamic = "force-dynamic";

// Static segment, shadowing nothing — /contacts has no [id] route, but the name is reserved here
// the same way /blog/categories is.
export default async function ContactTagsPage() {
  const supabase = createClient();

  // Same reasoning as /contacts: the (app) layout has already established the session, and a null
  // workspace is "no valid session", not a filter value.
  const ws = await currentWorkspaceId();
  if (!ws) redirect("/login");

  // The counts come from the contact_tag_counts view (0080), not from fetching every link row and
  // grouping them in JS. That shape was silently WRONG past PostgREST's default 1000-row ceiling —
  // a tenant who bulk-tagged a real lead list would have seen counts that stopped climbing with no
  // indication anything was truncated. Same bug, same fix, as the Funnels page's lead counts.
  const [{ data: tags }, { data: counts }] = await Promise.all([
    supabase
      .from("contact_tags")
      .select("id, name, color, description")
      .eq("workspace_id", ws)
      .order("name"),
    supabase.from("contact_tag_counts").select("tag_id, contact_count").eq("workspace_id", ws),
  ]);

  const countByTag = new Map<string, number>(
    (counts ?? []).map((c: any) => [c.tag_id as string, Number(c.contact_count) || 0])
  );

  return (
    <ContactTagsPanel
      tags={(tags ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color ?? null,
        description: t.description ?? null,
        contactCount: countByTag.get(t.id) ?? 0,
      }))}
    />
  );
}
