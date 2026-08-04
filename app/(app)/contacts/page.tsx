import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import type { Contact, ContactTag } from "@/lib/shared";
import ContactsTable from "@/components/ContactsTable";
import ContactErasePanel from "@/components/ContactErasePanel";
import Pager, { PAGE_SIZE, pageFromParam, pageRange } from "@/components/Pager";

// Real paid traffic accumulates leads fast — this list was capped at 1000 with no way to reach
// anything past it. Now paged, so the whole table is reachable and each page is one bounded query.
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { page?: string; tag?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();
  const tagFilter = searchParams.tag || null;

  // Filtering by tag uses an inner join on the link table rather than fetching ids and passing
  // them to .in() — that shape would silently cap the filter at whatever the id query returned,
  // so a tag with more leads than the cap would quietly show a subset. The join keeps count and
  // range honest for any size.
  const withTagFilter = <T,>(q: T): T => {
    if (!tagFilter) return q;
    return (q as any).eq("contact_tag_links.tag_id", tagFilter) as T;
  };

  const countSelect = tagFilter ? "id, contact_tag_links!inner(tag_id)" : "id";
  const { count } = await withTagFilter(
    supabase.from("contacts").select(countSelect, { count: "exact", head: true }).eq("workspace_id", ws)
  );
  const total = count ?? 0;
  const page = pageFromParam(searchParams.page, Math.ceil(total / PAGE_SIZE));
  const [from, to] = pageRange(page);

  const rowSelect = tagFilter
    ? "id, campaign_id, first_name, email, extra_fields, created_at, unsubscribed_at, contact_tag_links!inner(tag_id)"
    : "id, campaign_id, first_name, email, extra_fields, created_at, unsubscribed_at";

  const [{ data: rows }, { data: campaigns }, { data: allTags }] = await Promise.all([
    withTagFilter(
      supabase
        .from("contacts")
        .select(rowSelect)
        .eq("workspace_id", ws)
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
    supabase.from("campaigns").select("id, products(product_title)"),
    supabase
      .from("contact_tags")
      .select("id, name, color, description")
      .eq("workspace_id", ws)
      .order("name"),
  ]);

  const titleByCampaign = new Map<string, string>();
  for (const c of campaigns ?? []) {
    const title = (c as any).products?.product_title;
    if (title) titleByCampaign.set(c.id, title);
  }

  const tags: ContactTag[] = (allTags ?? []) as ContactTag[];
  const tagById = new Map(tags.map((t) => [t.id, t]));

  // Tags are fetched for THIS page's rows only. The inner-join select above can't double as the
  // tag list, because when a filter is active it returns only the matching link — a lead carrying
  // three tags would render showing one.
  const pageIds = (rows ?? []).map((r: any) => r.id);
  const tagsByContact = new Map<string, ContactTag[]>();
  if (pageIds.length > 0) {
    const { data: links } = await supabase
      .from("contact_tag_links")
      .select("contact_id, tag_id")
      .eq("workspace_id", ws)
      .in("contact_id", pageIds);
    for (const l of links ?? []) {
      const tag = tagById.get(l.tag_id);
      if (!tag) continue;
      const list = tagsByContact.get(l.contact_id) ?? [];
      list.push(tag);
      tagsByContact.set(l.contact_id, list);
    }
  }

  const contacts: Contact[] = (rows ?? []).map((r: any) => ({
    id: r.id,
    campaign_id: r.campaign_id,
    campaign_title: r.campaign_id ? (titleByCampaign.get(r.campaign_id) ?? null) : null,
    first_name: r.first_name,
    email: r.email,
    extra_fields: (r.extra_fields as Record<string, string>) ?? {},
    created_at: r.created_at,
    unsubscribed_at: r.unsubscribed_at ?? null,
    tags: tagsByContact.get(r.id) ?? [],
  }));

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Contacts</h1>
        <p className="text-sm text-zinc-400">
          Leads captured from your bridge pages' opt-in forms.
        </p>
      </header>
      <ContactsTable contacts={contacts} allTags={tags} activeTag={tagFilter} total={total} />
      <Pager
        page={page}
        total={total}
        basePath="/contacts"
        label="contacts"
        preserve={{ tag: tagFilter ?? undefined }}
      />
      <ContactErasePanel />
    </main>
  );
}
