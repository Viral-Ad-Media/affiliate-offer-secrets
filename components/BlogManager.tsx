"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Newspaper, Plus, Loader2, Tag, Import, ExternalLink, Trash2, Layers, Eye } from "lucide-react";
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
  importableCampaigns,
}: {
  posts: PostRow[];
  categories: Category[];
  importableCampaigns: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importCampaignId, setImportCampaignId] = useState("");
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const visiblePosts = filterCategory ? posts.filter((p) => p.category_id === filterCategory) : posts;

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

  async function createPost(campaignId?: string) {
    const data = await call(campaignId ? "import" : "new", "/api/blog/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(campaignId ? { campaign_id: campaignId } : {}),
    });
    if (data?.post_id) router.push(`/blog/${data.post_id}`);
  }

  // Backfill for campaigns built before posts were created automatically. Idempotent, so the
  // button stays useful (and harmless) afterwards.
  async function importAll() {
    const data = await call("import-all", "/api/blog/posts/import-all", { method: "POST" });
    if (!data) return;
    if (data.created > 0) {
      toast.success(
        `${data.created} draft ${data.created === 1 ? "post" : "posts"} created from your campaigns`
      );
    } else {
      toast.info("Every campaign with an article already has a post");
    }
    if (data.failed > 0) toast.error(`${data.failed} couldn't be imported — check the campaign kits`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
          <Newspaper className="h-5 w-5 text-emerald-400" /> Blog
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Import a campaign&apos;s generated article or write your own, organize with categories, then
          publish — each published post gets its own public URL.
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
            <select
              value={importCampaignId}
              onChange={(e) => setImportCampaignId(e.target.value)}
              className="max-w-56 rounded-lg border border-ink-600 bg-ink-900 py-1.5 px-2 text-xs outline-none focus:border-emerald-500"
            >
              <option value="">Import from campaign…</option>
              {importableCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!importCampaignId || busy === "import"}
              onClick={() => createPost(importCampaignId)}
              className="btn-ghost text-xs"
            >
              {busy === "import" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Import className="h-3.5 w-3.5" />}
              Import
            </button>
            <a
              href="/api/blog/preview"
              target="_blank"
              rel="noreferrer"
              title="Preview your blog home page — drafts included, so you can see the layout before publishing"
              className="btn-ghost text-xs"
            >
              <Eye className="h-3.5 w-3.5" /> Preview blog
            </a>
            <button
              type="button"
              disabled={busy === "import-all"}
              onClick={importAll}
              title="Create a draft post from every campaign that has a generated article"
              className="btn-ghost text-xs"
            >
              {busy === "import-all" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Layers className="h-3.5 w-3.5" />
              )}
              Import all
            </button>
            <button type="button" disabled={busy === "new"} onClick={() => createPost()} className="btn-primary text-xs">
              {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              New post
            </button>
          </div>
        </div>

        {error && <p className="mb-2 text-sm text-red-300">{error}</p>}

        {visiblePosts.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            No posts yet. Import a campaign&apos;s generated article or start from scratch.
          </p>
        ) : (
          <div className="divide-y divide-ink-800">
            {visiblePosts.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/blog/${p.id}`} className="block truncate text-sm font-medium text-zinc-100 hover:text-emerald-300">
                    {p.title}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
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
    </div>
  );
}
