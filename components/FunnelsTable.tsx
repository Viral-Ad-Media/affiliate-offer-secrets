"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Radio,
  ExternalLink,
  Beaker,
  Pencil,
  Eye,
  Settings2,
  Archive,
  ArchiveRestore,
  Trash2,
  Loader2,
  Palette,
  Globe,
  EyeOff,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";
import { THEME_PRESETS } from "@/lib/engine/pageTheme";

export type FunnelRow = {
  id: string;
  title: string;
  published: boolean;
  archived: boolean;
  leads: number;
  url: string;
  variantCount: number;
  stepCount: number;
};

type Action = "publish" | "unpublish" | "restyle" | "archive" | "unarchive" | "delete";

/**
 * The funnels list, with row selection and a bulk bar.
 *
 * Client-side because selection is client state; the page stays a server component and hands the
 * rows down already resolved. Nothing here decides authorization — /api/funnels/bulk re-resolves
 * every id against the caller's workspace, because the ids travel in a request body and the UI
 * having rendered them proves nothing.
 *
 * Row actions are icons (edit / preview / settings) rather than one "Manage" button, matching the
 * blog post list: they go to different places, and one button that means three things has to be
 * clicked before you learn which.
 */
export default function FunnelsTable({ funnels, showingArchived }: { funnels: FunnelRow[]; showingArchived: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Action | null>(null);
  const [restyleOpen, setRestyleOpen] = useState(false);

  const ids = Array.from(selected);
  const allSelected = funnels.length > 0 && selected.size === funnels.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function run(action: Action, extra: Record<string, unknown> = {}) {
    if (ids.length === 0) return;
    setBusy(action);
    const res = await fetch("/api/funnels/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, campaign_ids: ids, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    setRestyleOpen(false);
    if (!res.ok) {
      toast.error(data.error ?? "Couldn't do that");
      return;
    }
    // Refusals are reported alongside successes rather than swallowed — a bulk publish that
    // silently skipped half the selection is how someone concludes the feature is broken.
    const skipped = (data.skipped ?? []) as { id: string; reason: string }[];
    const noun = data.updated === 1 ? "funnel" : "funnels";
    if (skipped.length > 0) {
      const first = skipped[0];
      const name = funnels.find((f) => f.id === first.id)?.title ?? "One funnel";
      toast.error(
        `${data.updated} ${noun} updated. ${skipped.length} skipped — ${name}: ${first.reason}`
      );
    } else {
      toast.success(`${data.updated} ${noun} updated`);
    }
    setSelected(new Set());
    router.refresh();
  }

  function confirmDelete() {
    const names = ids
      .map((id) => funnels.find((f) => f.id === id)?.title)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    // Names what actually goes, not "are you sure?". Deleting a campaign takes the whole kit with
    // it, and someone who thinks they are removing a page should learn that here rather than after.
    const ok = window.confirm(
      `Delete ${ids.length} funnel${ids.length === 1 ? "" : "s"}${names ? ` (${names}${ids.length > 3 ? ", …" : ""})` : ""}?\n\n` +
        `This deletes each one's whole campaign kit — ad angles, TikTok scripts, the email sequence, the blog source, every step and split-test variant, every generated image and video, and any ad drafts. Captured leads and published blog posts are kept.\n\n` +
        `There is no undo. Archive instead if you just want it out of the way.`
    );
    if (ok) run("delete", { confirm: true });
  }

  return (
    <div className="relative">
      {selected.size > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b border-ink-700 bg-ink-900/95 px-4 py-2.5 backdrop-blur">
          <span className="text-xs font-medium text-zinc-300">
            {selected.size} selected
          </span>
          <button onClick={() => setSelected(new Set())} className="text-xs text-zinc-500 hover:text-zinc-300">
            Clear
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {!showingArchived && (
              <>
                <Button variant="outline" className="text-xs" disabled={!!busy} onClick={() => run("publish")}>
                  {busy === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                  Publish
                </Button>
                <Button variant="outline" className="text-xs" disabled={!!busy} onClick={() => run("unpublish")}>
                  <EyeOff className="h-3.5 w-3.5" /> Unpublish
                </Button>
                <div className="relative">
                  <Button variant="outline" className="text-xs" disabled={!!busy} onClick={() => setRestyleOpen((v) => !v)}>
                    {busy === "restyle" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
                    Restyle
                  </Button>
                  {restyleOpen && (
                    <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-xl">
                      {/* Non-destructive by construction: a preset only replaces `theme`, carrying
                          every block across by reference. Worth saying, because "restyle 8 funnels"
                          otherwise sounds like it rewrites their copy. */}
                      <p className="px-2 py-1.5 text-[11px] leading-snug text-zinc-500">
                        Repaints the selected funnels. Copy and layout are untouched.
                      </p>
                      {THEME_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => run("restyle", { preset: p.id })}
                          className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-ink-800"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            <Button
              variant="outline"
              className="text-xs"
              disabled={!!busy}
              onClick={() => run(showingArchived ? "unarchive" : "archive")}
            >
              {showingArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              {showingArchived ? "Restore" : "Archive"}
            </Button>
            <Button
              variant="outline"
              className="border-red-500/40 text-xs text-red-300 hover:border-red-500/60"
              disabled={!!busy}
              onClick={confirmDelete}
            >
              {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table className="w-full text-sm">
          <TableHeader>
            <tr>
              <TableHead edge className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select all funnels"
                  className="h-3.5 w-3.5 accent-emerald-500"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(funnels.map((f) => f.id)) : new Set())}
                />
              </TableHead>
              <TableHead>Funnel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Link</TableHead>
              <TableHead className="text-right">Steps</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead edge className="text-right">Actions</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {funnels.map((f) => (
              <TableRow key={f.id} className={cn(selected.has(f.id) && "bg-emerald-500/[0.06]")}>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${f.title}`}
                    className="h-3.5 w-3.5 accent-emerald-500"
                    checked={selected.has(f.id)}
                    onChange={() => toggle(f.id)}
                  />
                </td>
                <td className="px-2 py-2.5 font-medium text-zinc-100">{f.title}</td>
                <td className="px-2 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      className={
                        f.published
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : "border-ink-600 bg-ink-800 text-zinc-400"
                      }>
                      <Radio className="h-3 w-3" /> {f.published ? "Published" : "Draft"}
                    </Badge>
                    {/* Archiving deliberately doesn't unpublish, so this pair can disagree — and
                        when it does, an archived funnel is still taking real ad traffic. Said out
                        loud rather than left for someone to notice from the URL still working. */}
                    {f.archived && (
                      <Badge
                        className={
                          f.published
                            ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
                            : "border-ink-600 bg-ink-800 text-zinc-500"
                        }
                        title={f.published ? "Archived, but still live — unpublish to take it down" : undefined}
                      >
                        <Archive className="h-3 w-3" /> {f.published ? "Archived · still live" : "Archived"}
                      </Badge>
                    )}
                    {f.variantCount > 0 && (
                      <Badge className="border-sky-500/30 bg-sky-500/15 text-sky-300">
                        <Beaker className="h-3 w-3" /> Testing ({f.variantCount})
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="max-w-xs px-2 py-2.5 text-xs text-zinc-400">
                  {f.published ? (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 truncate hover:text-emerald-400"
                    >
                      <span className="truncate">{f.url}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-zinc-600">Not published</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums text-zinc-400">
                  {f.stepCount > 0 ? `+${f.stepCount}` : "—"}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{f.leads}</td>
                <td className="px-4 py-2.5">
                  {/* Three destinations, three icons — the funnel map (edit), the sandboxed
                      preview, and the map's own settings. A single "Manage" hid all three behind
                      a click that told you nothing about where you were going. */}
                  <div className="flex items-center justify-end gap-1">
                    <IconLink href={`/funnels/${f.id}`} label="Edit funnel" icon={Pencil} />
                    <IconLink
                      href={`/preview/funnel/${f.id}`}
                      label="Preview"
                      icon={Eye}
                      newTab
                    />
                    <IconLink href={`/funnels/${f.id}?settings=1`} label="Settings" icon={Settings2} />
                  </div>
                </td>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function IconLink({
  href,
  label,
  icon: Icon,
  newTab,
}: {
  href: string;
  label: string;
  icon: typeof Pencil;
  newTab?: boolean;
}) {
  const cls =
    "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-ink-600 text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-300";
  // aria-label as well as title: a tooltip describes, it doesn't name, and these buttons have no
  // visible text for a screen reader to read.
  return newTab ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls} title={label} aria-label={label}>
      <Icon className="h-3.5 w-3.5" />
    </a>
  ) : (
    <Link href={href} className={cls} title={label} aria-label={label}>
      <Icon className="h-3.5 w-3.5" />
    </Link>
  );
}
