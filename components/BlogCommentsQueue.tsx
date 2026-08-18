"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Trash2, ShieldAlert, Undo2, Loader2, MessageSquare } from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/EmptyState";

export type CommentRow = {
  id: string;
  post_id: string;
  post_title: string;
  author_name: string;
  author_email: string | null;
  body: string;
  rating: number | null;
  status: "pending" | "approved" | "spam";
  created_at: string;
};

const STATUS_STYLE: Record<CommentRow["status"], string> = {
  pending: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  approved: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  spam: "border-red-500/30 bg-red-500/15 text-red-300",
};

/**
 * The moderation queue. Approving is the ONLY path by which a stranger's words reach a public
 * page, so there is deliberately no select-all-approve: each comment gets its own click. Spam is
 * kept rather than deleted (it trains the reader's eye for what's arriving); delete is for what
 * shouldn't be stored at all.
 */
export default function BlogCommentsQueue({ comments }: { comments: CommentRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommentRow["status"] | "all">("pending");

  const visible = filter === "all" ? comments : comments.filter((c) => c.status === filter);
  const pendingCount = comments.filter((c) => c.status === "pending").length;

  async function setStatus(id: string, status: CommentRow["status"]) {
    setBusy(id);
    const res = await fetch(`/api/blog/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Couldn't update");
      return;
    }
    toast.success(status === "approved" ? "Approved — it's live on the post" : `Marked ${status}`);
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this comment permanently? There is no undo.")) return;
    setBusy(id);
    const res = await fetch(`/api/blog/comments/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      toast.error("Couldn't delete");
      return;
    }
    router.refresh();
  }

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Comments</h1>
          <p className="text-sm text-zinc-400">
            Nothing appears on a post until you approve it here.
            {pendingCount > 0 ? ` ${pendingCount} awaiting review.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {(["pending", "approved", "spam", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                filter === f ? "bg-emerald-600 text-white" : "border border-ink-600 text-zinc-400 hover:bg-ink-700"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      {visible.length === 0 ? (
        <Card>
          <EmptyState icon={MessageSquare} title={filter === "pending" ? "Nothing waiting" : "No comments here"} compact>
            {filter === "pending"
              ? "New comments from your published posts land here for review."
              : "Switch the filter above to see other statuses."}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold text-zinc-100">{c.author_name}</span>
                {c.rating !== null && (
                  <span className="text-sm text-amber-300" aria-label={`${c.rating} out of 5`}>
                    {"★".repeat(c.rating)}
                    {"☆".repeat(5 - c.rating)}
                  </span>
                )}
                <Badge className={STATUS_STYLE[c.status]}>{c.status}</Badge>
                <span className="text-xs text-zinc-500">
                  on <Link href={`/blog/${c.post_id}`} className="underline">{c.post_title}</Link>
                  {" · "}
                  {new Date(c.created_at).toLocaleString()}
                </span>
                {c.author_email && <span className="text-xs text-zinc-600">{c.author_email}</span>}
              </div>
              <p className="mt-2 whitespace-pre-line text-sm text-zinc-300">{c.body}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {c.status !== "approved" && (
                  <Button variant="outline" className="!py-1 text-xs" disabled={busy === c.id} onClick={() => setStatus(c.id, "approved")}>
                    {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Approve
                  </Button>
                )}
                {c.status === "approved" && (
                  <Button variant="outline" className="!py-1 text-xs" disabled={busy === c.id} onClick={() => setStatus(c.id, "pending")}>
                    <Undo2 className="h-3.5 w-3.5" /> Unapprove
                  </Button>
                )}
                {c.status !== "spam" && (
                  <Button variant="outline" className="!py-1 text-xs" disabled={busy === c.id} onClick={() => setStatus(c.id, "spam")}>
                    <ShieldAlert className="h-3.5 w-3.5" /> Spam
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="border-red-500/40 !py-1 text-xs text-red-300 hover:border-red-500/60"
                  disabled={busy === c.id}
                  onClick={() => remove(c.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
