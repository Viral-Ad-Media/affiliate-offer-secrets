"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Copy, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { workspaceOrigin } from "@/lib/host";

// Mirrors slugify_workspace() in 0041 closely enough for a live preview. The server re-slugifies
// and re-validates whatever is submitted, so this is guidance, not the boundary — but showing the
// URL as you type is the whole point of the field.
function previewSlug(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export default function WorkspaceSettings({
  workspaceId,
  name: initialName,
  slug: initialSlug,
  canEdit,
}: {
  workspaceId: string;
  name: string;
  slug: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // The workspace's real subdomain (this used to build a /w/{slug} URL — a route that never
  // existed). Falls back to the canonical host until NEXT_PUBLIC_ROOT_DOMAIN is configured.
  const publicUrl = workspaceOrigin(previewSlug(slug) || initialSlug);

  async function save() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("update_workspace", {
      p_workspace_id: workspaceId,
      p_name: name,
      p_slug: slug,
    });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return;
    }
    setMsg({ ok: true, text: "Workspace updated." });
    router.refresh();
  }

  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500 disabled:opacity-60";

  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <Building2 className="h-4 w-4 text-emerald-400" /> Workspace
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
          maxLength={80}
          className={field}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">Workspace URL</span>
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={!canEdit}
          maxLength={40}
          className={`${field} font-mono`}
        />
        <span className="mt-1 block text-[12px] text-zinc-500">
          This is your workspace&apos;s subdomain — where your team works and where funnel and blog
          links you share point.{" "}
          <strong className="text-amber-300/80">
            Changing it changes your workspace&apos;s URL and breaks links you&apos;ve already
            shared
          </strong>{" "}
          (ads already running are unaffected — they use the main domain).
        </span>
      </label>

      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-200">
          {publicUrl}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-2 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save workspace
          </button>
          {msg && (
            <span className={`text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
              {msg.text}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
