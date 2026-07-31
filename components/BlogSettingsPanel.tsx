"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, Loader2, CheckCircle2, ExternalLink, ImagePlus, Trash2 } from "lucide-react";
import { PERMALINK_STYLES, type PermalinkStyle } from "@/lib/blog";
import { toast } from "@/lib/toast";

export type Settings = {
  blog_title: string | null;
  author_name: string | null;
  slug: string | null;
  description: string | null;
  author_bio: string | null;
  author_avatar_url: string | null;
  permalink_style: PermalinkStyle | null;
};

const MAX_AVATAR_CHARS = 900_000;

// Blog → Settings. Everything here renders on the PUBLIC blog: the slug is the address of the
// index (/b/{slug}) and the prefix of every post URL, title/description head the index page, and
// the author block appears under every post and at the foot of the index.
export default function BlogSettingsPanel({ initial }: { initial: Settings }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [blogTitle, setBlogTitle] = useState(initial.blog_title ?? "");
  const [authorName, setAuthorName] = useState(initial.author_name ?? "");
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [authorBio, setAuthorBio] = useState(initial.author_bio ?? "");
  const [avatar, setAvatar] = useState<string | null>(initial.author_avatar_url);
  const [permalink, setPermalink] = useState<PermalinkStyle>(initial.permalink_style ?? "post");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [origin, setOrigin] = useState("");

  // Post-mount only — reading window during render would differ from the server HTML (hydration
  // mismatch), the same trap already hit in BlogPostEditor.
  useEffect(() => setOrigin(window.location.origin), []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/blog/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blog_title: blogTitle,
          author_name: authorName,
          slug,
          permalink_style: permalink,
          description,
          author_bio: authorBio,
          author_avatar_url: avatar,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast.success("Blog settings saved");
      if (data.settings?.slug) setSlug(data.settings.slug);
      setSavedAt(Date.now());
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function pickAvatar(file: File) {
    setError(null);
    try {
      setAvatar(await resizeToDataUrl(file));
    } catch (err: any) {
      setError(err?.message ?? "Could not read that image");
    }
  }

  const liveUrl = initial.slug && origin ? `${origin}/b/${initial.slug}` : null;

  return (
    <form onSubmit={save} className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
          <Settings className="h-5 w-5 text-emerald-400" /> Blog settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Your public blog&apos;s address and identity. These appear on the blog index and on every
          published post.
        </p>
      </div>

      {liveUrl && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
          <span className="font-medium">Your blog:</span>
          <a href={`/b/${initial.slug}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline decoration-emerald-700 hover:text-emerald-200">
            {liveUrl} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <section className="card space-y-4 p-4">
        <div className="text-sm font-semibold text-zinc-100">Blog</div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Blog address</span>
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-xs text-zinc-500">{origin || ""}/b/</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-blog"
              className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 font-mono text-xs outline-none placeholder:text-zinc-600 focus:border-emerald-500"
            />
          </div>
          <span className="mt-1 block text-[11px] text-zinc-500">
            Needed before your blog index is reachable. Letters, numbers and dashes.
          </span>
        </label>
        <fieldset className="block">
          <legend className="mb-1 block text-xs font-medium text-zinc-400">Permalink structure</legend>
          <div className="space-y-1.5">
            {PERMALINK_STYLES.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="radio"
                  name="permalink_style"
                  value={o.value}
                  checked={permalink === o.value}
                  onChange={() => setPermalink(o.value)}
                  className="accent-emerald-500"
                />
                <span>{o.label}</span>
                <code className="text-xs text-zinc-500">
                  {slug ? `/b/${slug}` : "/b/your-blog"}
                  {o.example}
                </code>
              </label>
            ))}
          </div>
          <span className="mt-1 block text-[11px] text-zinc-500">
            Applies to post URLs. Changing it doesn&apos;t break links you&apos;ve already shared —
            old addresses redirect to the new structure. A post with no publish date or no category
            falls back to just its name.
          </span>
        </fieldset>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Blog name</span>
          <input
            value={blogTitle}
            onChange={(e) => setBlogTitle(e.target.value)}
            placeholder="Woodworking Reviews"
            className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Tagline</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Honest reviews and build guides for hobby woodworkers."
            className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
          <span className="mt-1 block text-[11px] text-zinc-500">
            Shown under the blog name and used as the index page&apos;s meta description.
          </span>
        </label>
      </section>

      <section className="card space-y-4 p-4">
        <div className="text-sm font-semibold text-zinc-100">Author</div>
        <div className="flex flex-wrap items-start gap-4">
          <div className="shrink-0">
            <div className="h-16 w-16 overflow-hidden rounded-full border border-ink-600 bg-ink-800">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">No photo</div>
              )}
            </div>
            <div className="mt-2 flex gap-1">
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost text-[11px]">
                <ImagePlus className="h-3 w-3" /> Photo
              </button>
              {avatar && (
                <button type="button" onClick={() => setAvatar(null)} className="btn-ghost text-[11px]">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Author name</span>
              <input
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Bio</span>
              <textarea
                value={authorBio}
                onChange={(e) => setAuthorBio(e.target.value)}
                rows={3}
                placeholder="A sentence or two about who's writing — shown under every post."
                className="w-full resize-y rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
              />
            </label>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickAvatar(f);
            e.target.value = "";
          }}
        />
      </section>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save settings
        </button>
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="flex items-center gap-1 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
    </form>
  );
}

// Client-side downscale — server validation is the real boundary.
async function resizeToDataUrl(file: File): Promise<string> {
  const raw: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = raw;
  });
  let maxDim = 400;
  let quality = 0.85;
  for (let i = 0; i < 5; i++) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", quality);
    if (out.length <= MAX_AVATAR_CHARS) return out;
    maxDim = Math.round(maxDim * 0.75);
    quality = Math.max(0.5, quality - 0.1);
  }
  throw new Error("Image is too large even after compression — try a smaller file.");
}
