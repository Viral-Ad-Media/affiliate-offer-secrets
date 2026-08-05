"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Redo2, Sparkles, Undo2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

/**
 * Regenerate / Undo / Redo, in the editor's top bar beside Save and Publish.
 *
 * These belong next to the other actions that change the whole post, not buried in the SEO panel
 * where they used to sit — that panel is analysis (score, links, checks), and rewriting the article
 * is not a thing you go looking for under a score.
 *
 * Undo and redo are ONE slot, not a stack. `blog_posts.previous_version` holds a single snapshot
 * and the revert route swaps rather than discards: what it replaces becomes the next thing revert
 * would restore. So the same endpoint serves both directions, and which one is live depends purely
 * on where you are relative to the last regeneration — tracked in `direction` below. Showing both
 * buttons always enabled would imply a history that doesn't exist.
 */
export default function PostRevisionControls({
  postId,
  hasSnapshot,
  snapshotAt,
  onApplied,
  disabled,
}: {
  postId: string;
  hasSnapshot: boolean;
  snapshotAt: string | null;
  onApplied: () => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<"regenerate" | "revert" | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  // Which way the single swap slot currently points. A snapshot straight off the server is always
  // something to go BACK to; it only becomes a redo after this session has undone something.
  const [direction, setDirection] = useState<"undo" | "redo">("undo");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!askOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setAskOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [askOpen]);

  async function run(kind: "regenerate" | "revert") {
    setBusy(kind);
    try {
      const res = await fetch(`/api/blog/posts/${postId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "regenerate" ? { instruction } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Something went wrong");
        return;
      }
      if (kind === "regenerate") {
        // A fresh rewrite: the thing to go back to is the version it just replaced.
        setDirection("undo");
        setInstruction("");
        setAskOpen(false);
        toast.success("Post rewritten");
      } else {
        // The swap flipped which side of the change we're standing on, so the button flips too.
        setDirection((d) => (d === "undo" ? "redo" : "undo"));
        toast.success(direction === "undo" ? "Reverted" : "Redone");
      }
      onApplied();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const off = disabled || busy !== null;
  const when = snapshotAt ? new Date(snapshotAt).toLocaleString() : null;

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1">
      <Button
        type="button"
        onClick={() => run("revert")}
        disabled={off || !hasSnapshot || direction !== "undo"}
        title={
          !hasSnapshot
            ? "Nothing to undo yet — regenerating saves the current version first"
            : direction === "undo"
              ? `Undo the rewrite${when ? ` — back to ${when}` : ""}`
              : "Already undone — use Redo"
        }
        
        aria-label="Undo rewrite" variant="outline" className="px-2 text-xs disabled:opacity-40">
        {busy === "revert" && direction === "undo" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Undo2 className="h-3.5 w-3.5" />
        )}
      </Button>

      <Button
        type="button"
        onClick={() => run("revert")}
        disabled={off || !hasSnapshot || direction !== "redo"}
        title={direction === "redo" ? "Redo — put the rewritten version back" : "Nothing to redo"}
        
        aria-label="Redo rewrite" variant="outline" className="px-2 text-xs disabled:opacity-40">
        {busy === "revert" && direction === "redo" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Redo2 className="h-3.5 w-3.5" />
        )}
      </Button>

      <Button
        type="button"
        onClick={() => setAskOpen((v) => !v)}
        disabled={off}
        title="Rewrite this post with AI" variant="outline" className="flex items-center gap-1.5 text-xs">
        {busy === "regenerate" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        Regenerate
      </Button>

      {askOpen && (
        <div className="absolute right-0 top-full z-20 mt-1.5 w-72 rounded-lg border border-ink-700 bg-ink-900 p-3 shadow-lg">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            maxLength={400}
            autoFocus
            placeholder="Optional: what to change"
            onKeyDown={(e) => e.key === "Enter" && run("regenerate")}
            className="w-full rounded-lg border border-ink-600 bg-ink-950 px-2.5 py-1.5 text-xs outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
          <p className="mt-1.5 text-[11px] leading-snug text-zinc-500">
            {/* Said here rather than after the fact: one slot means a second rewrite drops the
                original for good, and finding that out by losing it is the bad version. */}
            Rewrites the whole post. The current version is saved first so Undo can bring it back —
            but only the last one is kept.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" onClick={() => setAskOpen(false)} variant="outline" className="text-xs">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => run("regenerate")}
              disabled={off} className="text-xs">
              Rewrite
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
