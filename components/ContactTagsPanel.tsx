"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tags, Plus, Loader2, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { TAG_COLOR_PRESETS, MAX_TAG_DESCRIPTION, readableTextOn } from "@/lib/contactTags";

type Tag = {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  contactCount: number;
};

const NO_COLOR = "#334155"; // the neutral chip a colourless tag renders as, here and in the table

// Swatch row shared by the add form and the edit form, so the two can't offer different palettes.
function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (c: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        title="No colour"
        onClick={() => onChange(null)}
        className={`h-5 w-5 rounded-full border ${
          value === null ? "border-zinc-100" : "border-ink-600"
        }`}
        style={{ backgroundColor: NO_COLOR }}
      />
      {TAG_COLOR_PRESETS.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange(c)}
          className={`h-5 w-5 rounded-full border ${
            value === c ? "border-zinc-100" : "border-transparent"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

// Contacts → Tags. The tenant's own axis for grouping leads, alongside the campaign that captured
// them (which is fixed at capture time). Writes go through /api/contacts/tags — contact_tags has
// no client write grants.
export default function ContactTagsPanel({ tags }: { tags: Tag[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(TAG_COLOR_PRESETS[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");

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
      body: JSON.stringify({ name: trimmed, color, description: description.trim() || null }),
    });
    if (data) {
      setName("");
      setDescription("");
      toast.success(`Tag "${trimmed}" added`);
    }
  }

  // PATCH always sends all three fields — see the route comment: a partial shape would leave no
  // way to clear a description or drop a colour back to neutral.
  async function saveEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed) return;
    const data = await call(`edit-${id}`, `/api/contacts/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: trimmed,
        color: editColor,
        description: editDescription.trim() || null,
      }),
    });
    if (data) {
      setEditingId(null);
      toast.success("Tag updated");
    }
  }

  function beginEdit(t: Tag) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditColor(t.color);
    setEditDescription(t.description ?? "");
    setError(null);
  }

  const inputCls =
    "rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500";

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
        <form onSubmit={add} className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New tag name"
              className={`w-56 ${inputCls}`}
            />
            <ColorPicker value={color} onChange={setColor} />
            <button
              type="submit"
              disabled={busy === "add" || !name.trim()}
              className="btn-primary text-xs"
            >
              {busy === "add" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add tag
            </button>
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_TAG_DESCRIPTION}
            placeholder="What this tag means (optional) — shown on hover in the leads table"
            className={`w-full max-w-lg ${inputCls}`}
          />
        </form>

        {error && <p className="mb-2 text-sm text-red-300">{error}</p>}

        {tags.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No tags yet.</p>
        ) : (
          <div className="divide-y divide-ink-800">
            {tags.map((t) => (
              <div key={t.id} className="py-2.5">
                {editingId === t.id ? (
                  <form onSubmit={(e) => saveEdit(e, t.id)} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                        className={`w-56 ${inputCls} py-1.5`}
                      />
                      <ColorPicker value={editColor} onChange={setEditColor} />
                      <button
                        type="submit"
                        title="Save"
                        className="text-emerald-400 hover:text-emerald-300"
                      >
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
                    </div>
                    <input
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      maxLength={MAX_TAG_DESCRIPTION}
                      placeholder="Description (optional)"
                      className={`w-full max-w-lg ${inputCls} py-1.5`}
                    />
                  </form>
                ) : (
                  <div className="flex items-center gap-3">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: t.color ?? NO_COLOR,
                        color: readableTextOn(t.color ?? NO_COLOR),
                      }}
                    >
                      {t.name}
                    </span>
                    <span className="flex-1 truncate text-xs text-zinc-500">
                      {t.description ?? ""}
                    </span>
                    <span className="whitespace-nowrap text-xs text-zinc-500">
                      {t.contactCount} {t.contactCount === 1 ? "contact" : "contacts"}
                    </span>
                    <button
                      type="button"
                      title="Edit tag"
                      onClick={() => beginEdit(t)}
                      className="text-zinc-600 hover:text-zinc-300"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Delete tag (contacts are kept)"
                      onClick={() => {
                        if (window.confirm(`Delete tag "${t.name}"? Contacts in it are kept.`)) {
                          call(`del-${t.id}`, `/api/contacts/tags/${t.id}`, {
                            method: "DELETE",
                          }).then((ok) => ok && toast.success(`Tag "${t.name}" deleted`));
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
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
