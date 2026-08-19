"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Cell = { kind: "click" | "scroll"; cell_x: number; cell_y: number; count: number };

/**
 * Native click heatmap + scroll-depth readout for one funnel page, drawn over the page's own
 * stored HTML. Data is the bounded density grid in funnel_heatmap_cells (0114) — 40 columns of
 * viewport width × 100 rows of document height — read through the browser client against the
 * table's workspace-member RLS, the CreativeItemCard pattern.
 *
 * The iframe is sandbox="allow-same-origin" with NO allow-scripts and NO allow-forms — the page's
 * pixels cannot fire and its forms cannot submit, the same two guarantees the map thumbnails'
 * empty sandbox provides. same-origin is added here for one measurable reason: the overlay must
 * know the document's rendered height to place cells expressed as % of it, and an opaque frame
 * cannot be measured. Scripts stay off, so the escape hatch that makes allow-scripts +
 * allow-same-origin dangerous never opens.
 */
export default function HeatmapDialog({
  campaignId,
  pageKey,
  title,
  html,
  onClose,
}: {
  campaignId: string;
  pageKey: string;
  title: string;
  html: string | null;
  onClose: () => void;
}) {
  const [cells, setCells] = useState<Cell[] | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [docHeight, setDocHeight] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("funnel_heatmap_cells")
        .select("kind, cell_x, cell_y, count")
        .eq("campaign_id", campaignId)
        .eq("page_key", pageKey);
      if (!cancelled) setCells((data ?? []) as Cell[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, pageKey]);

  // Measure the rendered document, then keep the canvas glued to it. Height settles as images
  // load, so one onLoad reading isn't enough — poll briefly rather than trusting the first paint.
  function measure() {
    const doc = iframeRef.current?.contentDocument;
    if (doc?.documentElement) setDocHeight(Math.max(1, doc.documentElement.scrollHeight));
  }
  useEffect(() => {
    const t = setInterval(measure, 500);
    const stop = setTimeout(() => clearInterval(t), 5000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, []);

  // Draw: one translucent radial blob per click cell, alpha scaled to the hottest cell, over a
  // slight dark wash so the hotspots read against light pages.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !docHeight || !cells) return;
    const w = canvas.clientWidth;
    canvas.width = w;
    canvas.height = docHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, docHeight);
    const clicks = cells.filter((c) => c.kind === "click");
    if (clicks.length === 0) return;
    const max = Math.max(...clicks.map((c) => c.count));
    const cellW = w / 40;
    const cellH = docHeight / 100;
    const radius = Math.max(cellW, cellH) * 1.6;
    for (const c of clicks) {
      const x = (c.cell_x + 0.5) * cellW;
      const y = (c.cell_y + 0.5) * cellH;
      const intensity = c.count / max;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(239,68,68,${0.55 * intensity})`);
      g.addColorStop(0.5, `rgba(245,158,11,${0.3 * intensity})`);
      g.addColorStop(1, "rgba(245,158,11,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }, [cells, docHeight]);

  const scroll = (cells ?? []).filter((c) => c.kind === "scroll");
  const scrollTotal = scroll.reduce((s, c) => s + c.count, 0);
  // % of visitors whose MAX depth reached at least this decile.
  const reached = (d: number) =>
    scrollTotal === 0 ? 0 : Math.round((scroll.filter((c) => c.cell_y >= d).reduce((s, c) => s + c.count, 0) / scrollTotal) * 100);
  const totalClicks = (cells ?? []).filter((c) => c.kind === "click").reduce((s, c) => s + c.count, 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Heatmap — {title}</DialogTitle>
        </DialogHeader>

        {cells === null ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
              <span>{totalClicks.toLocaleString()} clicks mapped</span>
              <span>{scrollTotal.toLocaleString()} visits with scroll depth</span>
              {scrollTotal > 0 && <span>reached 50%: {reached(5)}% · reached bottom: {reached(9)}%</span>}
            </div>
            {totalClicks === 0 && scrollTotal === 0 && (
              <p className="rounded-lg bg-ink-800 px-3 py-2 text-xs text-zinc-400">
                Nothing recorded yet — cells start filling the moment real visitors click and
                scroll this published page.
              </p>
            )}
            {!html ? (
              <p className="text-sm text-zinc-500">This page has no saved HTML to draw over.</p>
            ) : (
              <div className="relative overflow-hidden rounded-lg border border-ink-700 bg-white">
                <iframe
                  ref={iframeRef}
                  srcDoc={html}
                  sandbox="allow-same-origin"
                  title=""
                  aria-hidden
                  tabIndex={-1}
                  onLoad={measure}
                  scrolling="no"
                  className="w-full"
                  style={{ height: docHeight ?? 800, border: 0, pointerEvents: "none" }}
                />
                <canvas
                  ref={canvasRef}
                  className="pointer-events-none absolute inset-x-0 top-0 w-full"
                  style={{ height: docHeight ?? 800 }}
                />
                {/* Scroll-depth rail: how far visitors actually got, decile by decile. */}
                {scrollTotal > 0 && (
                  <div className="absolute inset-y-0 right-0 flex w-10 flex-col bg-black/30 text-center">
                    {Array.from({ length: 10 }, (_, d) => (
                      <div key={d} className="flex flex-1 items-center justify-center border-b border-white/10 text-[10px] font-medium text-white">
                        {reached(d)}%
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
