"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, CheckCircle2, ExternalLink, Copy } from "lucide-react";
import type { PageBlockTree } from "@/lib/engine/renderPages";
import { markdownToBlockTree, blogRenderCtx, renderBlockTree, renderPublicPostHtml, blogPostPath, type PermalinkStyle } from "@/lib/blog";
import EditorPreviewButton from "@/components/EditorPreview";
import StatusDropdownButton from "@/components/StatusDropdownButton";
import { toast } from "@/lib/toast";
import WysiwygCanvas from "@/components/WysiwygCanvas";
import SeoFields, { type SeoValues } from "@/components/SeoFields";
import PageChecklist from "@/components/PageChecklist";
import { blogPostChecklist } from "@/lib/pageChecklist";
import PostSeoPanel from "@/components/PostSeoPanel";
import PostRevisionControls from "@/components/PostRevisionControls";
import ContentWidthField from "@/components/ContentWidthField";
import KeywordsField from "@/components/KeywordsField";
import PageThemePanel from "@/components/PageThemePanel";
import FeaturedImageField from "@/components/FeaturedImageField";
import { resizeImageFile } from "@/lib/images/resizeClient";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Post = {
  id: string;
  title: string;
  content_md: string;
  page_copy: unknown;
  status: string;
  category_id: string | null;
  published_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_index: boolean;
  slug: string | null;
  excerpt: string | null;
  featured_image_url: string | null;
  featured_image_status: string;
  featured_image_error: string | null;
  previous_version: unknown;
  previous_saved_at: string | null;
};
type Category = { id: string; name: string; slug?: string | null };


// Same client-side downscale helper as PageEditor.tsx — UX only, the server's validator is the
// real boundary.

function isTree(v: unknown): v is PageBlockTree {
  return !!v && typeof v === "object" && (v as { version?: number }).version === 2;
}

// Blog post editor — the same WysiwygCanvas the funnel opt-in/step editors use, with the "blog"
// validator profile server-side (locked disclosure, no campaign-shaped blocks). Legacy posts
// (content_md only, pre-block-tree) are converted client-side on open and upgraded on first save.
export default function BlogPostEditor({
  post,
  categories,
  blogSlug,
  permalinkStyle,
}: {
  post: Post;
  categories: Category[];
  blogSlug: string | null;
  permalinkStyle: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(post.title);
  const [tree, setTree] = useState<PageBlockTree>(() =>
    isTree(post.page_copy) ? post.page_copy : markdownToBlockTree(post.content_md ?? "", { dropFirstH1: true })
  );
  const [categoryId, setCategoryId] = useState(post.category_id ?? "");
  const [status, setStatus] = useState(post.status);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [imageBusyBlockId, setImageBusyBlockId] = useState<string | null>(null);
  const [slug, setSlug] = useState(post.slug ?? "");
  const [excerpt, setExcerpt] = useState(post.excerpt ?? "");
  const [featuredImage, setFeaturedImage] = useState<string | null>(post.featured_image_url);
  const [seo, setSeo] = useState<SeoValues>({
    seo_title: post.seo_title ?? "",
    seo_description: post.seo_description ?? "",
    seo_index: post.seo_index,
  });

  async function patch(key: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/blog/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error ?? "Failed to save";
        setError(message);
        toast.error(message);
        return false;
      }
      setSavedAt(Date.now());
      router.refresh();
      return true;
    } catch (err: any) {
      setError(err?.message ?? String(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const ok = await patch("save", { title, blocks: tree.blocks, contentWidth: tree.contentWidth, theme: tree.theme, category_id: categoryId || null, slug, excerpt, featured_image_url: featuredImage, ...seo });
    if (ok) toast.success("Post saved");
  }

  // Set the post's status explicitly rather than toggling: the split button's menu can pick
  // either state directly, and a toggle would do the wrong thing if the two ever disagreed.
  async function setPostStatus(next: "published" | "draft") {
    // Publishing always saves current edits too — publishing stale content would be surprising.
    const ok = await patch("publish", { title, blocks: tree.blocks, contentWidth: tree.contentWidth, theme: tree.theme, category_id: categoryId || null, slug, excerpt, featured_image_url: featuredImage, ...seo, status: next });
    if (ok) {
      setStatus(next);
      toast.success(next === "published" ? "Post published" : "Post moved back to draft");
    }
  }

  // Origin is applied post-mount only — reading window.location during render makes the client's
  // first render differ from the server HTML (hydration mismatch, caught live).
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  // The REAL permalink, built with the same helper the public route uses — not `/b/{uuid}`, which
  // is only the legacy form kept alive as a 301. Showing the uuid meant the link you copied from
  // here was never the link visitors (or Google) actually see.
  //
  // Derived from the SAVED post, not the in-editor state: it's labelled "Live", and a URL built
  // from an unsaved slug would 404 until you pressed Save. router.refresh() after each save is
  // what keeps it current.
  const postPath = blogPostPath(
    blogSlug,
    post.slug,
    post.id,
    {
      published_at: post.published_at,
      category_slug: categories.find((c) => c.id === post.category_id)?.slug ?? null,
    },
    permalinkStyle as PermalinkStyle | null
  );
  const publicUrl = `${origin}${postPath}`;

  // Full-screen overlay, always covering 100% of the viewport — same treatment as the funnel
  // editor's edit views (app/(app)/funnels/[campaignId]/page.tsx): the app shell stays mounted
  // underneath but the editor owns the whole screen while open.
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-ink-950">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-ink-700 bg-ink-900/90 px-4 py-3 backdrop-blur">
        <Link href="/blog/posts" className="inline-flex shrink-0 items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Posts
        </Link>
        <div className="min-w-0 truncate text-sm font-medium text-zinc-100">{title || "Untitled post"}</div>
        <div className="flex shrink-0 items-center gap-2">
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="flex items-center gap-1 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <EditorPreviewButton
            className={cn(buttonVariants({ variant: "outline" }), "flex items-center gap-1.5 text-xs")}
            title={`Preview — ${title || "Untitled post"}`}
            render={() =>
              renderPublicPostHtml({
                id: post.id,
                title,
                slug,
                content_md: "",
                // The public page renders the block tree's write-time html, so the preview has to
                // re-render the CURRENT tree the same way the save route does — passing the saved
                // html would show the last save, not what's on screen.
                html: renderBlockTree(tree, blogRenderCtx()),
                excerpt,
                featured_image_url: featuredImage,
                // A draft has no published_at yet; today's date is closer to how it will look once
                // published than an empty date line.
                published_at: post.published_at ?? new Date().toISOString(),
                category_name: categories.find((c) => c.id === categoryId)?.name ?? null,
                seo_title: seo.seo_title,
                seo_description: seo.seo_description,
                seo_index: seo.seo_index,
                content_width: tree.contentWidth,
                theme: tree.theme,
              })
            }
          />
          <PostRevisionControls
            postId={post.id}
            hasSnapshot={!!post.previous_version}
            snapshotAt={post.previous_saved_at}
            onApplied={() => router.refresh()}
            disabled={busy !== null}
          />
          <Button type="button" onClick={save} disabled={busy !== null} variant="outline" className="text-xs">
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </Button>
          <StatusDropdownButton
            status={status === "published" ? "published" : "draft"}
            busy={busy !== null}
            onChange={setPostStatus}
          />
        </div>
      </div>

      {/* Full-bleed: the editor overlay owns the whole viewport, no centered max-width column. */}
      <div className="space-y-4 px-4 py-6">
      {status === "published" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
          <span className="font-medium">Live:</span>
          <a href={postPath} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline decoration-emerald-700 hover:text-emerald-200">
            {publicUrl} <ExternalLink className="h-3 w-3" />
          </a>
          <button
            type="button"
            title="Copy URL"
            onClick={() => {
              navigator.clipboard.writeText(publicUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="text-emerald-400 hover:text-emerald-200"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {copied && <span>Copied</span>}
        </div>
      )}

      {/* A draft has a link too — just a private one. /preview is signed-in only and
          workspace-scoped, so a post can be looked at as a real rendered page from the moment it
          exists, without publishing it to the blog index and the sitemap. Rendered by the SAME
          function the public route uses, so this is not an approximation of the published page. */}
      {status !== "published" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-xs text-zinc-400">
          <span className="font-medium text-zinc-300">Draft:</span>
          <a
            href={`/api/blog/preview/post/${post.id}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 underline decoration-ink-600 hover:text-emerald-300"
            title="Private preview — only people signed in to this workspace can open it"
          >
            Preview this post <ExternalLink className="h-3 w-3" />
          </a>
          <span className="text-zinc-600">· publishes to {publicUrl}</span>
        </div>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Post title"
          className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-lg font-semibold outline-none placeholder:text-zinc-600 focus:border-emerald-500"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-zinc-500">
        Click any text below to edit it in place, drag <span className="text-zinc-400">⠿</span> to
        reorder a block. Links inside text use markdown syntax: [link text](https://…). The
        affiliate disclosure is locked — it can&apos;t be edited or removed. Everything about the
        post itself — image, excerpt, URL, SEO, score and the checklist — is behind the ⚙ above the canvas.
      </p>

      <WysiwygCanvas
        settings={{
          title: "Post settings",
          // The same sections that used to stack above the canvas, moved behind the ⚙ so the
          // editor is actually an editor rather than a form with a canvas at the bottom. They are
          // the same components with the same state — nothing here is a second copy.
          panel: (
            <div className="space-y-4">
              {/* The checklist moved in HERE rather than being deleted. It used to sit above the
                  canvas precisely because half of what it checks — featured image, excerpt,
                  category — lives behind this ⚙; putting it beside those very fields answers that
                  concern better than keeping it outside did, since ticking an item and fixing it
                  are now the same place. */}
              <PageChecklist
                title="Post checklist"
                items={blogPostChecklist({
                  tree,
                  title,
                  excerpt,
                  seoDescription: seo.seo_description,
                  featuredImageUrl: featuredImage,
                  categoryId: categoryId || null,
                })}
              />
              <KeywordsField tree={tree} onChange={setTree} />
              <ContentWidthField tree={tree} onChange={setTree} />
              <PageThemePanel tree={tree} onChange={setTree} />
      <Card as="section" className="space-y-4 p-4">
        <FeaturedImageField
          postId={post.id}
          value={featuredImage}
          status={post.featured_image_status}
          error={post.featured_image_error}
          onChange={setFeaturedImage}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">URL slug</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="auto-from-title"
              className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 font-mono text-xs outline-none placeholder:text-zinc-600 focus:border-emerald-500"
            />
            <span className="mt-1 block text-[12px] text-zinc-500">
              The address of this post. Leave empty to follow the title.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Excerpt</span>
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={2}
              placeholder="Short summary shown on the blog index card."
              className="w-full resize-y rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-xs outline-none placeholder:text-zinc-600 focus:border-emerald-500"
            />
            <span className="mt-1 block text-[12px] text-zinc-500">
              Falls back to the first lines of the post if left empty.
            </span>
          </label>
        </div>
      </Card>

      <SeoFields
        values={seo}
        onChange={setSeo}
        fallbackTitle={title}
        showIndexToggle
      />

      {/* Scored from what's in the editor right now, not what's saved — the point is to react
          while you write. Rendering the tree here (rather than reading post.html) is what makes
          the link and heading counts reflect unsaved edits. */}
      <PostSeoPanel
        input={{
          title,
          contentMd: post.content_md,
          html: renderBlockTree(tree, blogRenderCtx()),
          excerpt,
          seoTitle: seo.seo_title,
          seoDescription: seo.seo_description,
          featuredImageUrl: featuredImage,
          slug,
          siteHosts: origin ? [new URL(origin).hostname] : [],
        }}
      />

      <p className="text-xs text-zinc-500">
        Click any text below to edit it in place, drag <span className="text-zinc-400">⠿</span> to
        reorder a block. Links inside text use markdown syntax: [link text](https://…). The
        affiliate disclosure is locked — it can&apos;t be edited or removed.
      </p>
            </div>
          ),
        }}
        tree={tree}
        onChange={setTree}
        resizeImageFile={resizeImageFile}
        imageBusyBlockId={imageBusyBlockId}
        onImageBusyChange={setImageBusyBlockId}
        onImageError={setError}
        productTitle={title}
      />
      </div>
    </div>
  );
}
