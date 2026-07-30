"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { marked } from "marked";
import { ArrowLeft, Loader2, Eye, Pencil, CheckCircle2, ExternalLink, Copy } from "lucide-react";

type Post = {
  id: string;
  title: string;
  content_md: string;
  status: string;
  category_id: string | null;
  published_at: string | null;
};
type Category = { id: string; name: string };

// Markdown editor with a write/preview toggle. Preview escapes & and < before marked.parse —
// the SAME pre-escaping the public route's renderer applies (lib/blog.ts), so what you preview
// is what visitors get, raw HTML disabled in both.
function previewHtml(md: string): string {
  return marked.parse(md.replace(/&/g, "&amp;").replace(/</g, "&lt;"), { async: false }) as string;
}

export default function BlogPostEditor({ post, categories }: { post: Post; categories: Category[] }) {
  const router = useRouter();
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content_md);
  const [categoryId, setCategoryId] = useState(post.category_id ?? "");
  const [status, setStatus] = useState(post.status);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const dirty = title !== post.title || content !== post.content_md || (post.category_id ?? "") !== categoryId;

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
    await patch("save", { title, content_md: content, category_id: categoryId || null });
  }

  async function togglePublish() {
    const next = status === "published" ? "draft" : "published";
    // Publishing always saves current edits too — publishing stale content would be surprising.
    const ok = await patch("publish", { title, content_md: content, category_id: categoryId || null, status: next });
    if (ok) setStatus(next);
  }

  // Origin is applied post-mount only — reading window.location during render makes the client's
  // first render differ from the server HTML (hydration mismatch, caught live).
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const publicUrl = `${origin}/b/${post.id}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/blog" className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Blog
        </Link>
        <div className="flex items-center gap-2">
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="flex items-center gap-1 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <button type="button" onClick={save} disabled={busy !== null || !dirty} className="btn-ghost text-xs">
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </button>
          <button type="button" onClick={togglePublish} disabled={busy !== null} className="btn-primary text-xs">
            {busy === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {status === "published" ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>

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

      <div className="card overflow-hidden">
        <div className="flex items-center gap-1 border-b border-ink-800 px-3 py-2">
          {(
            [
              ["write", Pencil, "Write"],
              ["preview", Eye, "Preview"],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${
                mode === key ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-zinc-600">Markdown</span>
        </div>
        {mode === "write" ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={24}
            spellCheck={false}
            className="w-full resize-y bg-transparent p-4 font-mono text-sm leading-6 text-zinc-200 outline-none"
            placeholder="Write your post in Markdown…"
          />
        ) : (
          <div
            className="max-w-none p-4 text-sm leading-7 text-zinc-300 [&_a]:text-emerald-400 [&_a]:underline [&_blockquote]:mt-3 [&_blockquote]:border-l-2 [&_blockquote]:border-ink-600 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-400 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-zinc-100 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-3 [&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-ink-800 [&_pre]:p-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: previewHtml(content) }}
          />
        )}
      </div>
    </div>
  );
}
