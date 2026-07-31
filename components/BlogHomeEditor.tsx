"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Home, Loader2, CheckCircle2, Settings, RefreshCw } from "lucide-react";
import WysiwygCanvas from "@/components/WysiwygCanvas";
import EditorPreviewButton from "@/components/EditorPreview";
import type { PageBlockTree } from "@/lib/engine/renderPages";
import {
  blogRenderCtx,
  emptyPostTree,
  renderBlockTree,
  renderBlogIndexHtml,
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
  // Bumped on save so the preview iframe refetches instead of showing the pre-save render.
  const [previewNonce, setPreviewNonce] = useState(0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/blog/home", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: tree.blocks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSavedAt(Date.now());
      setPreviewNonce((n) => n + 1);
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
                { ...settings, intro_html: renderBlockTree(tree, blogRenderCtx()) },
                posts,
                { page: 1, totalPages: 1 }
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

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Settings className="h-4 w-4 text-emerald-400" /> Live home page
          </div>
          <button
            type="button"
            onClick={() => setPreviewNonce((n) => n + 1)}
            title="Reload the preview"
            className="btn-ghost text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reload
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Your saved home page, drafts included. Save above to see edits here.
        </p>
        {/* sandbox="" for the same reason as every other preview in this app: no scripts, no form
            submits, nothing that could fire from a page being looked at rather than visited. */}
        <iframe
          key={previewNonce}
          src={`/api/blog/preview?v=${previewNonce}`}
          sandbox=""
          title="Blog home preview"
          className="h-[60vh] w-full rounded-lg border border-ink-700 bg-white"
        />
      </section>
    </div>
  );
}
