"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Newspaper, Plus, Loader2, Tag, ExternalLink, Trash2, Eye, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";

type PostRow = {
  id: string;
  title: string;
  status: string;
  category_id: string | null;
  campaign_id: string | null;
  published_at: string | null;
  updated_at: string;
};
type Category = { id: string; name: string };

// Blog manager list view: category chips (create/delete inline), posts table, new/import actions.
// All writes go through /api/blog/* routes (blog tables have no client write grants).
export default function BlogManager({
  posts,
  categories,
}: {
  posts: PostRow[];
  categories: Category[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [editing, setEditing] = useState<PostRow | null>(null);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const visiblePosts = filterCategory ? posts.filter((p) => p.category_id === filterCategory) : posts;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Bulk actions go through /api/blog/posts/bulk, which re-resolves every id against the caller's
  // workspace before touching anything — the ids in this component's state are a convenience, not
  // an authorization claim.
  async function bulk(action: string, categoryId?: string | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (action === "delete" && !window.confirm(`Delete ${ids.length} post(s)? This can't be undone.`)) return;

    setBulkBusy(true);
    setError(null);
    const res = await fetch("/api/blog/posts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, post_ids: ids, category_id: categoryId }),
    });
    const data = await res.json().catch(() => ({}));
    setBulkBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      toast.error(data.error ?? "Something went wrong");
      return;
    }
    toast.success(`Updated ${data.affected} post(s)`);
    setSelected(new Set());
    router.refresh();
  }

  async function call(key: string, url: string, init: RequestInit): Promise<any | null> {
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

  // Blank post only. Importing from a campaign is gone as a UI action — a kit's article becomes a
  // draft post automatically when the build finishes (finalizeBuildCampaign in lib/engine/worker.ts),
  // so a button asking someone to do by hand what already happened was just a way to be confused
  // about whether it had.
  async function createPost() {
    const data = await call("new", "/api/blog/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (data?.post_id) router.push(`/blog/${data.post_id}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
          <Newspaper className="h-5 w-5 text-emerald-400" /> Blog
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every campaign kit turns into a draft post automatically. Write your own too, organize
          with categories, then publish — each published post gets its own public URL.
        </p>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterCategory(null)}
            className={`rounded-full border px-3 py-1 text-xs ${
              filterCategory === null
                ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                : "border-ink-600 text-zinc-400 hover:border-ink-500"
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilterCategory(filterCategory === c.id ? null : c.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                filterCategory === c.id
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                  : "border-ink-600 text-zinc-400 hover:border-ink-500"
              }`}
            >
              {c.name}
            </button>
          ))}
          <Link href="/blog/categories" className="flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-300">
            <Tag className="h-3 w-3" /> Manage
          </Link>
        </div>
      )}

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-zinc-100">
            Posts {filterCategory ? `— ${categoryName.get(filterCategory)}` : ""}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/blog/preview"
              target="_blank"
              rel="noreferrer"
              title="Preview your blog home page — drafts included, so you can see the layout before publishing"
              className="btn-ghost text-xs"
            >
              <Eye className="h-3.5 w-3.5" /> Preview blog
            </a>
            <button type="button" disabled={busy === "new"} onClick={() => createPost()} className="btn-primary text-xs">
              {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              New post
            </button>
          </div>
        </div>

        {error && <p className="mb-2 text-sm text-red-300">{error}</p>}

        {selected.size > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">
            <span className="text-xs text-zinc-300">{selected.size} selected</span>
            <div className="h-4 w-px bg-ink-600" />
            <button onClick={() => bulk("publish")} disabled={bulkBusy} className="btn-ghost text-xs">
              Publish
            </button>
            <button onClick={() => bulk("unpublish")} disabled={bulkBusy} className="btn-ghost text-xs">
              Unpublish
            </button>
            <select
              disabled={bulkBusy}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = "";
                if (v) bulk("set_category", v === "__none" ? null : v);
              }}
              className="rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-zinc-200"
            >
              <option value="">Set category…</option>
              <option value="__none">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => bulk("delete")}
              disabled={bulkBusy}
              className="btn-ghost text-xs text-red-300 hover:text-red-200"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
            {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
            <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">
              Clear
            </button>
          </div>
        )}

        {visiblePosts.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            No posts yet. Build a campaign kit and its article lands here as a draft, or start from scratch.
          </p>
        ) : (
          <div className="divide-y divide-ink-800">
            <label className="flex items-center gap-2 py-1.5 text-[12px] text-zinc-500">
              <input
                type="checkbox"
                checked={visiblePosts.every((p) => selected.has(p.id))}
                onChange={() =>
                  setSelected(
                    visiblePosts.every((p) => selected.has(p.id))
                      ? new Set()
                      : new Set(visiblePosts.map((p) => p.id))
                  )
                }
                className="accent-emerald-500"
              />
              Select all shown
            </label>
            {visiblePosts.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  aria-label={`Select ${p.title}`}
                  className="accent-emerald-500"
                />
                <div className="min-w-0 flex-1">
                  <Link href={`/blog/${p.id}`} className="block truncate text-sm font-medium text-zinc-100 hover:text-emerald-300">
                    {p.title}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-[12px] text-zinc-500">
                    <span
                      className={`rounded-full px-2 py-px ${
                        p.status === "published" ? "bg-emerald-500/15 text-emerald-300" : "bg-ink-800 text-zinc-400"
                      }`}
                    >
                      {p.status === "published" ? "Published" : "Draft"}
                    </span>
                    {p.category_id && categoryName.get(p.category_id) && <span>{categoryName.get(p.category_id)}</span>}
                    <span>Updated {new Date(p.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <a
                  href={`/api/blog/preview/post/${p.id}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Preview this post as it will look published"
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  <Eye className="h-4 w-4" />
                </a>
                {p.status === "published" && (
                  <a
                    href={`/b/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title="View public post"
                    className="text-zinc-500 hover:text-emerald-400"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  title="Quick edit (title, category, status)"
                  onClick={() => setEditing(p)}
                  className="text-zinc-600 hover:text-zinc-300"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Delete post"
                  onClick={() => {
                    if (window.confirm(`Delete "${p.title}"? This can't be undone.`)) {
                      call(`del-${p.id}`, `/api/blog/posts/${p.id}`, { method: "DELETE" });
                    }
                  }}
                  className="text-zinc-600 hover:text-red-400"
                >
                  {busy === `del-${p.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {editing && (
        <QuickEditPost
          post={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// Title, category and status without opening the full block editor — the three things you change
// when tidying a list, none of which need the canvas. Reuses the SAME PATCH route the editor
// saves through (it already handles all three), so there is no second write path to keep in step.
function QuickEditPost({
  post,
  categories,
  onClose,
  onSaved,
}: {
  post: PostRow;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(post.title);
  const [categoryId, setCategoryId] = useState<string>(post.category_id ?? "");
  const [status, setStatus] = useState(post.status);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return setErr("Title can't be empty");
    setSaving(true);
    setErr(null);
    const res = await fetch(`/api/blog/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        category_id: categoryId || null,
        status,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setErr(data.error ?? "Couldn't save");
    toast.success("Post updated");
    onSaved();
  }

  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Quick edit</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
            <p className="mt-1 text-[12px] text-zinc-500">
              The post&apos;s URL slug follows the title, and old links to the previous slug stop
              resolving.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
          {err && <p className="text-sm text-red-400">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn-ghost text-sm">
              Cancel
            </button>
            <button onClick={save} disabled={saving} className="btn-primary text-sm">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
