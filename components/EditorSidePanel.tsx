"use client";

import { X } from "lucide-react";

/**
 * The editor's side-rail panel chrome, without the style controls.
 *
 * BlockStylePanel draws this same box around the style groups; this is the same box for anything
 * else that docks in that rail — today, the blog home's post-list settings. Shared so the two
 * can't drift into looking like different kinds of panel, which would undercut the whole point of
 * putting the post list on the canvas: that it behaves like every other element.
 */
export default function EditorSidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 lg:mt-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
        <button type="button" onClick={onClose} title="Deselect" className="text-zinc-500 hover:text-zinc-300">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-4">{children}</div>
    </div>
  );
}
