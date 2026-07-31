"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tag, Plus, Loader2, Trash2, Pencil, Check, X } from "lucide-react";

type Category = { id: string; name: string; postCount: number };

// Blog → Categories submenu page. Writes via /api/blog/categories (admin-client routes).
export default function BlogCategoriesPanel({ categories }: { categories: Category[] }) {
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
    const data = await call("add", "/api/blog/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (data) setName("");
  }

  async function rename(e: React.FormEvent, id: string) {
    e.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed) return;
    const data = await call(`edit-${id}`, `/api/blog/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (data) setEditingId(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
          <Tag className="h-5 w-5 text-emerald-400" /> Blog categories
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Organize your posts. Renaming one keeps its public filter link working — the link uses the
          slug from when it was created, not the current name. Deleting a category keeps its posts —
          they just become uncategorized.
        </p>
      </div>

      <section className="card p-4">
        <form onSubmit={add} className="mb-4 flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category name"
            className="w-64 rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
          <button type="submit" disabled={busy === "add" || !name.trim()} className="btn-primary text-xs">
            {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add category
          </button>
        </form>

        {error && <p className="mb-2 text-sm text-red-300">{error}</p>}

        {categories.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No categories yet.</p>
        ) : (
          <div className="divide-y divide-ink-800">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5">
                {editingId === c.id ? (
                  <form onSubmit={(e) => rename(e, c.id)} className="flex flex-1 items-center gap-2">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                      className="w-64 rounded-lg border border-ink-600 bg-ink-900 py-1.5 px-2.5 text-sm outline-none focus:border-emerald-500"
                    />
                    <button
                      type="submit"
                      title="Save name"
                      disabled={busy === `edit-${c.id}` || !editName.trim()}
                      className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                    >
                      {busy === `edit-${c.id}` ? (
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
                  <span className="flex-1 text-sm text-zinc-100">{c.name}</span>
                )}
                <span className="text-xs text-zinc-500">
                  {c.postCount} {c.postCount === 1 ? "post" : "posts"}
                </span>
                {editingId !== c.id && (
                  <button
                    type="button"
                    title="Rename category"
                    onClick={() => {
                      setEditingId(c.id);
                      setEditName(c.name);
                      setError(null);
                    }}
                    className="text-zinc-600 hover:text-zinc-300"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  title="Delete category (posts are kept)"
                  onClick={() => {
                    if (window.confirm(`Delete category "${c.name}"? Posts in it are kept, just uncategorized.`)) {
                      call(`del-${c.id}`, `/api/blog/categories/${c.id}`, { method: "DELETE" });
                    }
                  }}
                  className="text-zinc-600 hover:text-red-400"
                >
                  {busy === `del-${c.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
