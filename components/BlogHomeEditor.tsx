"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Home, Loader2, CheckCircle2, LayoutGrid, Rows3 } from "lucide-react";
import WysiwygCanvas from "@/components/WysiwygCanvas";
import EditorPreviewButton from "@/components/EditorPreview";
import type { PageBlockTree } from "@/lib/engine/renderPages";
import {
  blogRenderCtx,
  emptyPostTree,
  indexLayout,
  renderBlockTree,
  renderBlogIndexHtml,
  MIN_INDEX_COLUMNS,
  MAX_INDEX_COLUMNS,
  MIN_INDEX_ROWS,
  MAX_INDEX_ROWS,
  type BlogIndexLayout,
  type BlogIndexPost,
  type BlogSettings,
} from "@/lib/blog";
import { toast } from "@/lib/toast";
import { resizeImageFile } from "@/lib/images/resizeClient";

function isTree(v: unknown): v is PageBlockTree {
  return !!v && typeof v === "object" && (v as { version?: number }).version === 2;
}

// Blog → Home. The rest of the index is generated (site header, category chips, post grid), so the
// editable part is the intro band between the header and the posts — that's what this writes.
// Identity fields (blog name, tagline, author) stay on Settings rather than being duplicated here.
export default function BlogHomeEditor({
  settings,
  posts,
}: {
  settings: BlogSettings & { intro_copy?: unknown };
  posts: BlogIndexPost[];
}) {
  const router = useRouter();
  const [tree, setTree] = useState<PageBlockTree>(() =>
    // emptyPostTree(), not normalizePageCopy(null) — the latter seeds the bridge-page skeleton
    // ("How it works", "What you get"), which is the wrong starting point for a blog intro.
    isTree(settings.intro_copy) ? (settings.intro_copy as PageBlockTree) : emptyPostTree()
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [imageBusyBlockId, setImageBusyBlockId] = useState<string | null>(null);
  // Post-list layout. indexLayout() clamps whatever is stored, so the controls always start from
  // a value that's actually in range.
  const stored = indexLayout(settings);
  const [layout, setLayout] = useState<BlogIndexLayout>(stored.layout);
  const [columns, setColumns] = useState(stored.columns);
  const [rows, setRows] = useState(stored.rows);

  // What the reader sees per page — the same derivation the server does, shown here so the choice
  // isn't abstract.
  const perPage = (layout === "list" ? 1 : columns) * rows;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/blog/home", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: tree.blocks,
          index_layout: layout,
          index_columns: columns,
          index_rows: rows,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSavedAt(Date.now());
      toast.success("Blog home saved");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
      toast.error(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
            <Home className="h-5 w-5 text-emerald-400" /> Blog home
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            The intro that sits above your post list. Everything else on the home page — the blog
            name, tagline, category chips, post grid and author box — is generated from your posts
            and{" "}
            <Link href="/blog/settings" className="underline hover:text-zinc-300">
              blog settings
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <EditorPreviewButton
            className="btn-ghost flex items-center gap-1.5 text-xs"
            label="Preview home"
            title="Preview — blog home"
            // Renders the whole index from the CURRENT intro plus the real posts, so what you see
            // is the finished page rather than the band on its own.
            render={() =>
              renderBlogIndexHtml(
                {
                  ...settings,
                  intro_html: renderBlockTree(tree, blogRenderCtx()),
                  // The unsaved choices, not the stored ones — otherwise switching to a list and
                  // pressing Preview would show the old grid.
                  index_layout: layout,
                  index_columns: columns,
                  index_rows: rows,
                },
                posts.slice(0, perPage),
                { page: 1, totalPages: Math.max(1, Math.ceil(posts.length / perPage)) }
              )
            }
          />
          <button onClick={save} disabled={busy || !!imageBusyBlockId} className="btn-primary text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </button>
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="flex items-center gap-1 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <section className="space-y-2">
        <p className="text-xs text-zinc-500">
          Click any text to edit it in place, drag ⠿ to reorder. The affiliate disclosure is locked
          — the home page links to affiliate articles, so it can&apos;t be edited or removed.
        </p>
        <WysiwygCanvas
          tree={tree}
          onChange={setTree}
          resizeImageFile={resizeImageFile}
          imageBusyBlockId={imageBusyBlockId}
          onImageBusyChange={setImageBusyBlockId}
          onImageError={setError}
          productTitle={settings.blog_title ?? "Blog"}
        />
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Post list</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            How the posts below your intro are laid out. Columns × rows is also the page size, so
            the pager and the grid can never disagree.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="mb-1 block text-xs text-zinc-400">Layout</span>
            <div className="flex items-center gap-1">
              {([
                { value: "grid" as const, label: "Grid", icon: LayoutGrid },
                { value: "list" as const, label: "List", icon: Rows3 },
              ]).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setLayout(o.value)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    layout === o.value
                      ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                      : "border-ink-600 text-zinc-400 hover:bg-ink-700"
                  }`}
                >
                  <o.icon className="h-3.5 w-3.5" /> {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hidden rather than disabled for a list: one post per row isn't a setting you can
              change, it's what a list is. Leaving a dead control on screen invites the question. */}
          {layout === "grid" && (
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Columns</span>
              <select
                value={columns}
                onChange={(e) => setColumns(Number(e.target.value))}
                className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
              >
                {Array.from({ length: MAX_INDEX_COLUMNS - MIN_INDEX_COLUMNS + 1 }, (_, i) => i + MIN_INDEX_COLUMNS).map(
                  (n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  )
                )}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Rows per page</span>
            <select
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
              className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
            >
              {Array.from({ length: MAX_INDEX_ROWS - MIN_INDEX_ROWS + 1 }, (_, i) => i + MIN_INDEX_ROWS).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <p className="pb-2 text-xs text-zinc-500">
            {perPage} post{perPage === 1 ? "" : "s"} per page
            {posts.length > perPage ? ` · ${Math.ceil(posts.length / perPage)} pages today` : ""}
          </p>
        </div>

        {/* Narrow screens collapse to fewer columns regardless — worth saying once here rather
            than letting someone conclude the setting didn't save when they check on a phone. */}
        <p className="text-xs text-zinc-600">
          On phones and small tablets the grid narrows automatically; the page size stays the same.
        </p>
      </section>

    </div>
  );
}
