"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Copy,
  CheckCircle2,
  Download,
  Trash2,
  Loader2,
  Pencil,
  TagsIcon,
  Inbox,
  MailX,
  Plus,
  X,
} from "lucide-react";
import type { Contact, ContactTag } from "@/lib/shared";
import { readableTextOn } from "@/lib/contactTags";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/EmptyState";

// Flattens a lead's user-added form fields (Phase O.5) into one "key: value; key: value" string —
// deliberate v1 scope cut, matching the plan's own call: no dynamic per-field columns, since the
// field set varies per campaign/variant and even changes over time as a tenant edits their form.
function flattenExtraFields(extraFields: Record<string, string>): string {
  return Object.entries(extraFields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

function TagChip({ tag, onRemove }: { tag: ContactTag; onRemove?: () => void }) {
  const bg = tag.color ?? "#334155";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium"
      style={{ backgroundColor: bg, color: readableTextOn(bg) }}
      title={tag.description ?? tag.name}
    >
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} className="opacity-70 hover:opacity-100" aria-label={`Remove ${tag.name}`}>
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

export default function ContactsTable({
  contacts,
  allTags,
  activeTag,
  total,
  campaigns,
}: {
  contacts: Contact[];
  allTags: ContactTag[];
  activeTag: string | null;
  total: number;
  campaigns: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  const allOnPageSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allOnPageSelected ? new Set() : new Set(contacts.map((c) => c.id)));
  }

  async function copyEmail(id: string, email: string) {
    await navigator.clipboard.writeText(email);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }

  // Deleting a lead is irreversible and it's someone else's data, so it asks first — and names the
  // address, since one row in a long table is easy to mis-click.
  async function deleteContact(c: Contact) {
    if (!window.confirm(`Delete ${c.email}? This can't be undone.`)) return;
    setDeletingId(c.id);
    const { data, error } = await createClient().rpc("delete_contact", { p_contact_id: c.id });
    setDeletingId(null);
    if (error) return toast.error(error.message);
    if (!data) return toast.error("That contact no longer exists");
    toast.success(`Deleted ${c.email}`);
    router.refresh();
  }

  async function bulk(action: string, tagId?: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (action === "delete" && !window.confirm(`Delete ${ids.length} lead(s)? This can't be undone.`))
      return;

    setBusy(true);
    const res = await fetch("/api/contacts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, contact_ids: ids, tag_id: tagId }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) return toast.error(json.error ?? "Something went wrong");
    toast.success(`${action === "untag" ? "Untagged" : action === "tag" ? "Tagged" : action === "delete" ? "Deleted" : "Updated"} ${json.affected} lead(s)`);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Captured leads</h2>
            <p className="text-xs text-zinc-500">
              Every visitor who submitted a bridge page opt-in form.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setAdding(true)} className="text-xs">
              <Plus className="h-3.5 w-3.5" /> Add contact
            </Button>
            {total > 0 && (
              <a
                href="/api/contacts/export"
                title="Download every contact, not just this page"
                className={cn(buttonVariants({ variant: "outline" }), "text-xs")}
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </a>
            )}
          </div>
        </div>

        {/* Tag filter. Plain links, so the filter is shareable and survives a refresh — and the
            pager carries it across pages via its `preserve` prop. */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-800 px-4 py-2">
            <TagsIcon className="h-3.5 w-3.5 text-zinc-500" />
            <Link
              href="/contacts"
              className={`rounded-full px-2 py-0.5 text-[12px] ${
                activeTag ? "text-zinc-400 hover:text-zinc-200" : "bg-ink-700 text-zinc-100"
              }`}
            >
              All
            </Link>
            {allTags.map((t) => {
              const on = activeTag === t.id;
              const bg = t.color ?? "#334155";
              return (
                <Link
                  key={t.id}
                  href={`/contacts?tag=${t.id}`}
                  aria-current={on ? "true" : undefined}
                  title={t.description ?? undefined}
                  className="rounded-full px-2 py-0.5 text-[12px] font-medium"
                  style={
                    on
                      ? { backgroundColor: bg, color: readableTextOn(bg) }
                      : { color: bg, border: `1px solid ${bg}66` }
                  }
                >
                  {t.name}
                </Link>
              );
            })}
          </div>
        )}

        {/* Bulk bar — only present when something is selected, so it never takes space it isn't
            earning. */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 bg-ink-800/40 px-4 py-2">
            <span className="text-xs text-zinc-300">{selected.size} selected</span>
            <div className="h-4 w-px bg-ink-600" />

            <select
              disabled={busy || allTags.length === 0}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = "";
                if (v) bulk("tag", v);
              }}
              className="rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-zinc-200"
            >
              <option value="">Add tag…</option>
              {allTags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            <select
              disabled={busy || allTags.length === 0}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = "";
                if (v) bulk("untag", v);
              }}
              className="rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-zinc-200"
            >
              <option value="">Remove tag…</option>
              {allTags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            <Button onClick={() => bulk("unsubscribe")} disabled={busy} variant="outline" className="text-xs">
              <MailX className="h-3.5 w-3.5" /> Unsubscribe
            </Button>
            <Button
              onClick={() => bulk("delete")}
              disabled={busy} variant="outline" className="text-xs text-red-300 hover:text-red-200">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
            >
              Clear
            </button>
          </div>
        )}

        {contacts.length === 0 ? (
          activeTag ? (
            <EmptyState icon={TagsIcon} title="No leads carry this tag yet" compact>
              Tag a lead from its row, or clear the filter above to see everyone.
            </EmptyState>
          ) : (
            <EmptyState icon={Inbox} title="No leads captured yet" action={{ href: "/funnels", label: "Go to funnels" }}>
              Leads arrive here when someone submits a funnel&apos;s opt-in form. You can also
              add one by hand with <span className="text-zinc-400">Add contact</span>, or bring a
              list in from{" "}
              <Link href="/contacts/import" className="underline">
                CSV import
              </Link>
              .
            </EmptyState>
          )
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                      aria-label="Select all on this page"
                      className="accent-emerald-500"
                    />
                  </th>
                  <th className="px-2 py-2">When</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Tags</th>
                  <th className="px-2 py-2">Campaign</th>
                  <th className="px-2 py-2">Extra</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-ink-800">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        aria-label={`Select ${c.email}`}
                        className="accent-emerald-500"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-zinc-500">
                      {new Date(c.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-2 py-2 text-zinc-300">{c.first_name || "—"}</td>
                    <td className="px-2 py-2 text-zinc-300">
                      {c.email}
                      {c.unsubscribed_at && (
                        <span
                          className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[11px] text-amber-300"
                          title={`Unsubscribed ${new Date(c.unsubscribed_at).toLocaleDateString()}`}
                        >
                          unsubscribed
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.length === 0 ? (
                          <span className="text-xs text-zinc-600">—</span>
                        ) : (
                          c.tags.map((t) => <TagChip key={t.id} tag={t} />)
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-zinc-400">{c.campaign_title ?? "—"}</td>
                    <td
                      className="max-w-[14rem] truncate px-2 py-2 text-xs text-zinc-500"
                      title={flattenExtraFields(c.extra_fields)}
                    >
                      {Object.keys(c.extra_fields).length > 0 ? flattenExtraFields(c.extra_fields) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditing(c)}
                          title="Edit this lead"
                          className="rounded p-1 text-zinc-500 hover:text-zinc-200"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => copyEmail(c.id, c.email)}
                          title="Copy email"
                          className="rounded p-1 text-zinc-500 hover:text-zinc-200"
                        >
                          {copiedId === c.id ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => deleteContact(c)}
                          disabled={deletingId === c.id}
                          title="Delete this lead"
                          className="rounded p-1 text-zinc-500 hover:text-red-400"
                        >
                          {deletingId === c.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && (
        <AddContactDialog
          allTags={allTags}
          campaigns={campaigns}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}

      {editing && (
        <EditContactDialog
          contact={editing}
          allTags={allTags}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * Add one lead by hand — someone you met, or who replied, rather than someone who filled in a
 * bridge page. Sibling to the CSV import at /contacts/import; this is the one-off case, which
 * shouldn't cost a trip through a file picker.
 *
 * Tagging on the way in is offered because a manually added lead is exactly the kind that needs
 * to be findable later: it has no campaign attached, so a tag is the only thing that will
 * distinguish it from everything else in the list.
 */
function AddContactDialog({
  allTags,
  campaigns,
  onClose,
  onSaved,
}: {
  allTags: ContactTag[];
  campaigns: { id: string; title: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [tagId, setTagId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500";

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        first_name: firstName,
        tag_id: tagId || null,
        campaign_id: campaignId || null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      // The duplicate case is a 409 with a real explanation — surfacing it beats a generic
      // failure, since "already on your list" is an answer, not an error.
      setError(json.error ?? "Couldn't add that contact");
      return;
    }
    toast.success(`Added ${email.trim().toLowerCase()}`);
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Add contact</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">First name</label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Optional"
              className={field}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && email.trim() && !saving) save();
              }}
              placeholder="name@example.com"
              autoFocus
              className={field}
            />
          </div>

          {campaigns.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Campaign</label>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className={field}
              >
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-zinc-500">
                Which offer this lead belongs to, the same way a bridge-page opt-in is attributed.
              </p>
            </div>
          )}

          {allTags.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Tag</label>
              <select value={tagId} onChange={(e) => setTagId(e.target.value)} className={field}>
                <option value="">No tag</option>
                {allTags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose} variant="outline" className="text-sm">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !email.trim()} className="text-sm">
              {saving ? "Adding…" : "Add contact"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditContactDialog({
  contact,
  allTags,
  onClose,
  onSaved,
}: {
  contact: Contact;
  allTags: ContactTag[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(contact.first_name ?? "");
  const [email, setEmail] = useState(contact.email);
  const [extra, setExtra] = useState<Record<string, string>>({ ...contact.extra_fields });
  const [tags, setTags] = useState<ContactTag[]>(contact.tags);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const untagged = allTags.filter((t) => !tags.some((x) => x.id === t.id));

  // Tag edits apply immediately through the same bulk endpoint the multi-select uses, rather than
  // being batched into Save — one code path for "attach a tag to N leads", where N happens to be 1.
  async function applyTag(action: "tag" | "untag", tag: ContactTag) {
    const res = await fetch("/api/contacts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, contact_ids: [contact.id], tag_id: tag.id }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast.error(j.error ?? "Couldn't update tags");
    }
    setTags((prev) =>
      action === "tag" ? [...prev, tag] : prev.filter((t) => t.id !== tag.id)
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name: firstName, email, extra_fields: extra }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(json.error ?? "Couldn't save");
    toast.success("Lead updated");
    onSaved();
  }

  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Edit lead</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">First name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
          </div>

          {Object.keys(extra).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400">Form fields</p>
              {Object.entries(extra).map(([k, v]) => (
                <div key={k}>
                  <label className="mb-1 block text-[12px] text-zinc-500">{k}</label>
                  <input
                    value={v}
                    onChange={(e) => setExtra((p) => ({ ...p, [k]: e.target.value }))}
                    className={field}
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-medium text-zinc-400">Tags</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <TagChip key={t.id} tag={t} onRemove={() => applyTag("untag", t)} />
              ))}
              {untagged.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const t = untagged.find((x) => x.id === e.target.value);
                    e.target.value = "";
                    if (t) applyTag("tag", t);
                  }}
                  className="rounded border border-ink-600 bg-ink-900 px-2 py-0.5 text-[12px] text-zinc-300"
                >
                  <option value="">+ Add tag…</option>
                  {untagged.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose} variant="outline" className="text-sm">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="text-sm">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
