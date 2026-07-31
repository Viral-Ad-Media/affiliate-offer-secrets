"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tags, Plus, Loader2, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "@/lib/toast";

type Tag = { id: string; name: string; contactCount: number };

// Contacts → Tags. The tenant's own axis for grouping leads, alongside the campaign that captured
// them (which is fixed at capture time). Writes go through /api/contacts/tags — contact_tags has
// no client write grants.
export default function ContactTagsPanel({ tags }: { tags: Tag[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function call(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        toast.error(data.error ?? "Something went wrong");
        return null;
      }
      router.refresh();
      return data;
    } catch (err: any) {
      setError(err?.message ?? String(err));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const data = await call("add", "/api/contacts/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (data) {
      setName("");
      toast.success(`Tag "${trimmed}" added`);
    }
  }

  async function rename(e: React.FormEvent, id: string) {
    e.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed) return;
    const data = await call(`edit-${id}`, `/api/contacts/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (data) {
      setEditingId(null);
      toast.success("Tag updated");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
          <Tags className="h-5 w-5 text-emerald-400" /> Contact tags
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Group leads your own way — by interest, source, or funnel stage. Deleting a tag keeps the
          contacts; only the grouping goes.
        </p>
      </div>

      <section className="card p-4">
        <form onSubmit={add} className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New tag name"
            className="w-64 rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
          <button type="submit" disabled={busy === "add" || !name.trim()} className="btn-primary text-xs">
            {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add tag
          </button>
        </form>

        {error && <p className="mb-2 text-sm text-red-300">{error}</p>}

        {tags.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No tags yet.</p>
        ) : (
          <div className="divide-y divide-ink-800">
            {tags.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5">
                {editingId === t.id ? (
                  <form onSubmit={(e) => rename(e, t.id)} className="flex flex-1 items-center gap-2">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                      className="w-64 rounded-lg border border-ink-600 bg-ink-900 py-1.5 px-2.5 text-sm outline-none focus:border-emerald-500"
                    />
                    <button type="submit" title="Save" className="text-emerald-400 hover:text-emerald-300">
                      {busy === `edit-${t.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Cancel"
                      onClick={() => setEditingId(null)}
                      className="text-zinc-600 hover:text-zinc-300"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <span className="flex-1 text-sm text-zinc-100">{t.name}</span>
                )}
                <span className="text-xs text-zinc-500">
                  {t.contactCount} {t.contactCount === 1 ? "contact" : "contacts"}
                </span>
                {editingId !== t.id && (
                  <button
                    type="button"
                    title="Rename tag"
                    onClick={() => {
                      setEditingId(t.id);
                      setEditName(t.name);
                      setError(null);
                    }}
                    className="text-zinc-600 hover:text-zinc-300"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  title="Delete tag (contacts are kept)"
                  onClick={() => {
                    if (window.confirm(`Delete tag "${t.name}"? Contacts in it are kept.`)) {
                      call(`del-${t.id}`, `/api/contacts/tags/${t.id}`, { method: "DELETE" }).then(
                        (ok) => ok && toast.success(`Tag "${t.name}" deleted`)
                      );
                    }
                  }}
                  className="text-zinc-600 hover:text-red-400"
                >
                  {busy === `del-${t.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
