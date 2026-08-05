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
  blogPostPath,
  type BlogIndexLayout,
  type BlogIndexPost,
  type BlogSettings,
  type PermalinkStyle,
} from "@/lib/blog";
import { toast } from "@/lib/toast";
import { resizeImageFile } from "@/lib/images/resizeClient";
import { Button } from "@/components/ui/button";

function isTree(v: unknown): v is PageBlockTree {
  return !!v && typeof v === "object" && (v as { version?: number }).version === 2;
}


// Not a real block id — the appendix lives outside the tree, and this must never collide with one
// the canvas could resolve via findBlockLocation.
const POST_LIST_BLOCK_ID = "__post_list__";

/**
 * What the post list looks like on the page sheet, at the chosen shape.
 *
 * Shows the REAL posts, and their titles link to the real published pages (new tab).
 *
 * It used to draw grey skeletons, on the reasoning that the point is the LAYOUT and real titles
 * would imply this editor can edit them. In practice that read as "the links on the blog home
 * don't work" — because there were none. Real titles also demonstrate the layout BETTER, since
 * real titles have real lengths and a skeleton bar never wraps the way a long one does.
 *
 * Editing a post still happens on its own page; these are links out, not fields. Drafts are shown
 * (they're in the editor's data) but marked, since they won't appear publicly.
 *
 * Mirrors the public stylesheet's proportions — 16:9 thumbnails, one-per-row list with the image
 * beside the text — so what you pick reads the same way it will publish.
 */
function PostListPreview({
  layout,
  columns,
  rows,
  perPage,
  posts,
  hrefFor,
}: {
  layout: BlogIndexLayout;
  columns: number;
  rows: number;
  perPage: number;
  posts: BlogIndexPost[];
  hrefFor: (p: BlogIndexPost) => string;
}) {
  // Cap the drawn cards so a 4x12 choice doesn't render 48 skeletons into the sheet; the label
  // below still states the real number, so nothing is hidden by the cap.
  const shown = Math.min(perPage, layout === "list" ? 3 : columns * Math.min(rows, 2));
  const visible = posts.slice(0, shown);
  return (
    <div className="my-4">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">
        Post list — {layout === "list" ? "list" : `${columns}-column grid`}, {perPage} per page
      </div>
      {layout === "list" ? (
        <div className="space-y-3">
          {visible.map((p) => (
            <div key={p.id} className="flex gap-3 border-b border-gray-200 pb-3 last:border-b-0">
              <Thumb post={p} className="h-14 w-24 shrink-0" />
              <div className="min-w-0 flex-1 pt-1">
                <CardTitle post={p} href={hrefFor(p)} />
                <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-gray-500">{p.excerpt ?? ""}</p>
              </div>
            </div>
          ))}
          {visible.length === 0 && <EmptyNote />}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {visible.map((p) => (
            <div key={p.id} className="space-y-1.5">
              <Thumb post={p} className="aspect-video w-full" />
              <CardTitle post={p} href={hrefFor(p)} />
              <p className="line-clamp-2 text-[12px] leading-snug text-gray-500">{p.excerpt ?? ""}</p>
            </div>
          ))}
          {visible.length === 0 && <EmptyNote />}
        </div>
      )}
    </div>
  );
}

function Thumb({ post, className }: { post: BlogIndexPost; className: string }) {
  return post.featured_image_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={post.featured_image_url} alt="" className={`${className} rounded-md object-cover`} />
  ) : (
    <div className={`${className} rounded-md bg-gradient-to-br from-emerald-50 to-sky-50`} />
  );
}

function CardTitle({ post, href }: { post: BlogIndexPost; href: string }) {
  const draft = !post.published_at;
  return (
    <span className="flex items-start gap-1.5">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        // stopPropagation: clicking inside the canvas normally selects the block, and a link that
        // selects instead of navigating is the exact complaint this preview caused.
        onClick={(e) => e.stopPropagation()}
        className="line-clamp-2 text-[13px] font-semibold text-gray-800 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-600"
      >
        {post.title}
      </a>
      {draft && (
        <span className="mt-px shrink-0 rounded bg-gray-200 px-1 text-[10px] text-gray-600">Draft</span>
      )}
    </span>
  );
}

function EmptyNote() {
  return <p className="text-[12px] text-gray-400">No posts yet — published posts will appear here.</p>;
}

/** The post list's settings, shown in the canvas side rail like any block's. */
function PostListSettings({
  layout,
  columns,
  rows,
  perPage,
  totalPosts,
  onLayout,
  onColumns,
  onRows,
}: {
  layout: BlogIndexLayout;
  columns: number;
  rows: number;
  perPage: number;
  totalPosts: number;
  onLayout: (v: BlogIndexLayout) => void;
  onColumns: (v: number) => void;
  onRows: (v: number) => void;
}) {
  const label = "mb-1 block text-[12px] font-medium text-zinc-400";
  const input = "w-full rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-zinc-100";
  return (
    <>
      <div>
        <span className={label}>Layout</span>
        <div className="flex items-center gap-1">
          {(
            [
              { value: "grid" as const, label: "Grid", icon: LayoutGrid },
              { value: "list" as const, label: "List", icon: Rows3 },
            ]
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onLayout(o.value)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-[11px] font-medium ${
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

      <div className="grid grid-cols-2 gap-3">
        {/* Hidden rather than disabled for a list: one post per row isn't a setting you can
            change, it's what a list is. A dead control on screen invites the question. */}
        {layout === "grid" && (
          <label className="block">
            <span className={label}>Columns</span>
            <select value={columns} onChange={(e) => onColumns(Number(e.target.value))} className={input}>
              {Array.from(
                { length: MAX_INDEX_COLUMNS - MIN_INDEX_COLUMNS + 1 },
                (_, i) => i + MIN_INDEX_COLUMNS
              ).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className={label}>Rows per page</span>
          <select value={rows} onChange={(e) => onRows(Number(e.target.value))} className={input}>
            {Array.from({ length: MAX_INDEX_ROWS - MIN_INDEX_ROWS + 1 }, (_, i) => i + MIN_INDEX_ROWS).map(
              (n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              )
            )}
          </select>
        </label>
      </div>

      <p className="text-[11px] text-zinc-500">
        {perPage} post{perPage === 1 ? "" : "s"} per page
        {totalPosts > perPage ? ` · ${Math.ceil(totalPosts / perPage)} pages today` : ""}. Columns ×
        rows is the page size, so the pager and the grid can never disagree. On phones the grid
        narrows automatically; the page size stays the same.
      </p>
    </>
  );
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
          <Button onClick={save} disabled={busy || !!imageBusyBlockId} className="text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </Button>
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
          Click any text to edit it in place, drag ⠿ to reorder, and click the ⚙ on a block to open
          its settings. The affiliate disclosure is locked — the home page links to affiliate
          articles, so it can&apos;t be edited or removed. The post list below your intro is
          generated from your posts; its layout is a block setting like any other.
        </p>
        <WysiwygCanvas
          tree={tree}
          onChange={setTree}
          resizeImageFile={resizeImageFile}
          imageBusyBlockId={imageBusyBlockId}
          onImageBusyChange={setImageBusyBlockId}
          onImageError={setError}
          productTitle={settings.blog_title ?? "Blog"}
          appendix={{
            id: POST_LIST_BLOCK_ID,
            title: "Post list",
            preview: (
              <PostListPreview
                layout={layout}
                columns={columns}
                rows={rows}
                perPage={perPage}
                posts={posts}
                hrefFor={(p) =>
                  blogPostPath(settings.slug, p.slug, p.id, p, settings.permalink_style as PermalinkStyle | null)
                }
              />
            ),
            panel: (
              <PostListSettings
                layout={layout}
                columns={columns}
                rows={rows}
                perPage={perPage}
                totalPosts={posts.length}
                onLayout={setLayout}
                onColumns={setColumns}
                onRows={setRows}
              />
            ),
          }}
        />
      </section>

    </div>
  );
}
