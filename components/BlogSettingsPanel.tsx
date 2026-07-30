"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, Loader2, CheckCircle2 } from "lucide-react";

type Settings = { blog_title: string | null; author_name: string | null };

// Blog → Settings submenu page. Both values render on every public post page (/b/{postId}):
// blog name as the title-tag suffix, author as the byline in the post meta line.
export default function BlogSettingsPanel({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [blogTitle, setBlogTitle] = useState(initial.blog_title ?? "");
  const [authorName, setAuthorName] = useState(initial.author_name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/blog/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blog_title: blogTitle, author_name: authorName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSavedAt(Date.now());
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
          <Settings className="h-5 w-5 text-emerald-400" /> Blog settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Shown on every published post: the blog name appears in the browser tab, the author as
          the byline.
        </p>
      </div>

      <form onSubmit={save} className="card max-w-lg space-y-4 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Blog name</label>
          <input
            value={blogTitle}
            onChange={(e) => setBlogTitle(e.target.value)}
            placeholder="e.g. The Workshop Journal"
            className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Author name</label>
          <input
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="e.g. Alex Carpenter"
            className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save settings
          </button>
          {savedAt && Date.now() - savedAt < 4000 && (
            <span className="flex items-center gap-1 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
