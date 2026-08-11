import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import type { Contact, ContactTag } from "@/lib/shared";
import ContactsTable from "@/components/ContactsTable";
import ContactErasePanel from "@/components/ContactErasePanel";
import Pager, { PAGE_SIZE, pageFromParam, pageRange } from "@/components/Pager";

// Real paid traffic accumulates leads fast — this list was capped at 1000 with no way to reach
// anything past it. Now paged, so the whole table is reachable and each page is one bounded query.
//
// It is also down to TWO sequential Supabase round trips (count/campaigns/tags in parallel, then
// the page of rows), from five. That was the actual cost here — the payload is tiny (a contact row
// averages 293 bytes) and every query plans in under a millisecond, so this page was never slow
// because of the database; it was slow because it talked to it five times in a row before
// rendering anything. Two of those five were pure duplication of work the (app) layout had already
// done on the same request.
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { page?: string; tag?: string };
}) {
  const supabase = createClient();

  // No getUser() here on purpose. The (app) layout above already redirected if there is no
  // session, and getUser() is a real round trip to the auth server every time it's called — this
  // page's copy answered a question that had been answered moments earlier. currentWorkspaceId()
  // is React-cache()d per request, so the layout's call already paid for this one.
  //
  // A null workspace means the session behind this request is no longer valid; it is NOT a filter
  // value. `.eq("workspace_id", null)` sends PostgREST `eq.null`, which Postgres refuses to cast
  // to uuid — a 500 where a redirect was meant.
  const ws = await currentWorkspaceId();
  if (!ws) redirect("/login");

  const tagFilter = searchParams.tag || null;

  // Filtering by tag uses an inner join on the link table rather than fetching ids and passing
  // them to .in() — that shape would silently cap the filter at whatever the id query returned,
  // so a tag with more leads than the cap would quietly show a subset. The join keeps count and
  // range honest for any size. Aliased `f` so the row query below can embed the SAME table a
  // second time, unfiltered, for the chips (see rowSelect).
  const withTagFilter = <T,>(q: T): T => {
    if (!tagFilter) return q;
    return (q as any).eq("f.tag_id", tagFilter) as T;
  };

  const countSelect = tagFilter ? "id, f:contact_tag_links!inner(tag_id)" : "id";

  // The campaign titles and the tag list don't depend on which page you're on, so they no longer
  // wait behind the count — only the row query genuinely does (the page number is clamped against
  // the total, and an out-of-range .range() is a 416 from PostgREST, not an empty list).
  const [{ count }, { data: campaigns }, { data: allTags }, { data: attributes }] = await Promise.all([
    withTagFilter(
      supabase.from("contacts").select(countSelect, { count: "exact", head: true }).eq("workspace_id", ws)
    ),
    // Scoped and bounded. It was neither: no workspace filter meant a member of two workspaces got
    // both workspaces' campaigns merged into the title map and the edit dialog's picker, and no
    // limit meant this grew forever behind a page that only ever needs titles for 50 rows.
    supabase
      .from("campaigns")
      .select("id, products(product_title)")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("contact_tags")
      .select("id, name, color, description")
      .eq("workspace_id", ws)
      .order("name"),
    // The custom-field library (0082) — only key+label, purely so the Extra column can show
    // "Budget range" where the row stores "budget_range". Joins this Promise.all rather than
    // adding a fifth round trip, same reason the tag embeds were folded into the row query.
    supabase.from("contact_attributes").select("key, label").eq("workspace_id", ws),
  ]);

  // fieldKey -> label. A key with no definition keeps showing its raw key downstream: that is the
  // normal state for anything captured before the registry existed, and the value is still real.
  const attributeLabels = Object.fromEntries(
    ((attributes ?? []) as { key: string; label: string }[]).map((a) => [a.key, a.label])
  );

  const total = count ?? 0;
  const page = pageFromParam(searchParams.page, Math.ceil(total / PAGE_SIZE));
  const [from, to] = pageRange(page);

  // Two embeds of the same table, which is what removes the fourth round trip. `f` is the inner
  // join that does the filtering and returns ONLY the matching link; `tag_links` is a plain embed
  // returning every tag on the row, which is what the chips need — a lead carrying three tags
  // would otherwise render showing the one it was filtered by. Verified live against PostgREST:
  // with both embeds present and a filter active, `f` came back with one tag, `tag_links` with
  // both, and the exact count header was still correct.
  const tagEmbed = "tag_links:contact_tag_links(tag_id)";
  const baseCols = "id, campaign_id, first_name, email, extra_fields, created_at, unsubscribed_at";
  const rowSelect = tagFilter
    ? `${baseCols}, f:contact_tag_links!inner(tag_id), ${tagEmbed}`
    : `${baseCols}, ${tagEmbed}`;

  const { data: rows } = await withTagFilter(
    supabase
      .from("contacts")
      .select(rowSelect)
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  const titleByCampaign = new Map<string, string>();
  for (const c of campaigns ?? []) {
    const title = (c as any).products?.product_title;
    if (title) titleByCampaign.set(c.id, title);
  }

  // Same rows the title map above is built from — the picker doesn't need its own query.
  const campaignOptions = Array.from(titleByCampaign, ([id, title]) => ({ id, title })).sort((a, b) =>
    a.title.localeCompare(b.title)
  );

  const tags: ContactTag[] = (allTags ?? []) as ContactTag[];
  const tagById = new Map(tags.map((t) => [t.id, t]));

  const contacts: Contact[] = (rows ?? []).map((r: any) => ({
    id: r.id,
    campaign_id: r.campaign_id,
    campaign_title: r.campaign_id ? (titleByCampaign.get(r.campaign_id) ?? null) : null,
    first_name: r.first_name,
    email: r.email,
    extra_fields: (r.extra_fields as Record<string, string>) ?? {},
    created_at: r.created_at,
    unsubscribed_at: r.unsubscribed_at ?? null,
    tags: ((r.tag_links ?? []) as { tag_id: string }[])
      .map((l) => tagById.get(l.tag_id))
      .filter((t): t is ContactTag => !!t),
  }));

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Contacts</h1>
        <p className="text-sm text-zinc-400">
          Leads captured from your bridge pages' opt-in forms.
        </p>
      </header>
      <ContactsTable
        contacts={contacts}
        allTags={tags}
        activeTag={tagFilter}
        total={total}
        campaigns={campaignOptions}
        attributeLabels={attributeLabels}
      />
      <Pager
        page={page}
        total={total}
        basePath="/contacts"
        label="contacts"
        preserve={{ tag: tagFilter ?? undefined }}
      />
      <ContactErasePanel workspaceId={ws} />
    </main>
  );
}
