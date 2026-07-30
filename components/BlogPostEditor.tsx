"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, CheckCircle2, ExternalLink, Copy } from "lucide-react";
import type { PageBlockTree } from "@/lib/engine/renderPages";
import { markdownToBlockTree } from "@/lib/blog";
import WysiwygCanvas from "@/components/WysiwygCanvas";
import SeoFields, { type SeoValues } from "@/components/SeoFields";

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
};
type Category = { id: string; name: string };

const MAX_IMAGE_DATA_URL_CHARS = 280_000;

// Same client-side downscale helper as PageEditor.tsx — UX only, the server's validator is the
// real boundary.
async function resizeImageFile(file: File): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = dataUrl;
  });

  let maxDim = 1000;
  let quality = 0.82;
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const resized = canvas.toDataURL("image/jpeg", quality);
    if (resized.length <= MAX_IMAGE_DATA_URL_CHARS) return resized;
    maxDim = Math.round(maxDim * 0.75);
    quality = Math.max(0.5, quality - 0.15);
  }
  throw new Error("Image is too large even after compression — try a smaller file.");
}

function isTree(v: unknown): v is PageBlockTree {
  return !!v && typeof v === "object" && (v as { version?: number }).version === 2;
}

// Blog post editor — the same WysiwygCanvas the funnel opt-in/step editors use, with the "blog"
// validator profile server-side (locked disclosure, no campaign-shaped blocks). Legacy posts
// (content_md only, pre-block-tree) are converted client-side on open and upgraded on first save.
export default function BlogPostEditor({ post, categories }: { post: Post; categories: Category[] }) {
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
        setError(data.error ?? "Failed to save");
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
    await patch("save", { title, blocks: tree.blocks, category_id: categoryId || null, ...seo });
  }

  async function togglePublish() {
    const next = status === "published" ? "draft" : "published";
    // Publishing always saves current edits too — publishing stale content would be surprising.
    const ok = await patch("publish", { title, blocks: tree.blocks, category_id: categoryId || null, ...seo, status: next });
    if (ok) setStatus(next);
  }

  // Origin is applied post-mount only — reading window.location during render makes the client's
  // first render differ from the server HTML (hydration mismatch, caught live).
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const publicUrl = `${origin}/b/${post.id}`;

  // Full-screen overlay, always covering 100% of the viewport — same treatment as the funnel
  // editor's edit views (app/(app)/funnels/[campaignId]/page.tsx): the app shell stays mounted
  // underneath but the editor owns the whole screen while open.
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-ink-950">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-ink-700 bg-ink-900/90 px-4 py-3 backdrop-blur">
        <Link href="/blog" className="inline-flex shrink-0 items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Posts
        </Link>
        <div className="min-w-0 truncate text-sm font-medium text-zinc-100">{title || "Untitled post"}</div>
        <div className="flex shrink-0 items-center gap-2">
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="flex items-center gap-1 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <button type="button" onClick={save} disabled={busy !== null} className="btn-ghost text-xs">
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </button>
          <button type="button" onClick={togglePublish} disabled={busy !== null} className="btn-primary text-xs">
            {busy === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {status === "published" ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      {status === "published" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
          <span className="font-medium">Live:</span>
          <a href={`/b/${post.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline decoration-emerald-700 hover:text-emerald-200">
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

      <SeoFields
        values={seo}
        onChange={setSeo}
        fallbackTitle={title}
        showIndexToggle
      />

      <p className="text-xs text-zinc-500">
        Click any text below to edit it in place, drag <span className="text-zinc-400">⠿</span> to
        reorder a block. Links inside text use markdown syntax: [link text](https://…). The
        affiliate disclosure is locked — it can&apos;t be edited or removed.
      </p>

      <WysiwygCanvas
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
