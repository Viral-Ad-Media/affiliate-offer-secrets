"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, ClipboardList, Circle, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { checklistProgress, type ChecklistItem } from "@/lib/pageChecklist";
import { cn } from "@/lib/utils";

/**
 * "What this kind of page still needs" — the collapsible section above the canvas, shared by the
 * funnel opt-in editor, the funnel step editor and the blog post editor.
 *
 * Deliberately advisory, never a gate. Nothing here can block a save, and it must not: a page is
 * legitimately incomplete for as long as someone is building it, and an editor that refuses to
 * save half-finished work is worse than one that says nothing. `recommended` items are visually
 * quieter than `required` ones for the same reason — the point is to be useful, not to nag.
 *
 * It opens itself when something required is missing and stays shut once everything is done, so
 * it's loud exactly when it has something to say. See lib/pageChecklist.ts for the actual rules.
 */
export default function PageChecklist({
  items,
  title = "Required elements",
  subtitle,
}: {
  items: ChecklistItem[];
  title?: string;
  /** e.g. the funnel type's label, so it's clear WHICH kind of page these rules came from. */
  subtitle?: string;
}) {
  const { requiredDone, requiredTotal, allDone } = checklistProgress(items);
  const missingRequired = requiredTotal - requiredDone;
  // Start open only when there's something required still outstanding.
  const [open, setOpen] = useState(missingRequired > 0);

  if (items.length === 0) return null;

  return (
    <Card as="section" className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-zinc-100 hover:bg-ink-800/50"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-500" />
        )}
        <ClipboardList className="h-4 w-4 text-emerald-400" /> {title}
        {subtitle && <span className="text-xs font-normal text-zinc-500">· {subtitle}</span>}
        <span
          className={cn(
            "ml-auto text-xs font-normal",
            missingRequired > 0 ? "text-amber-400" : allDone ? "text-emerald-400" : "text-zinc-500"
          )}
        >
          {missingRequired > 0
            ? `${requiredDone} of ${requiredTotal} essentials`
            : allDone
              ? "All done"
              : "Essentials done"}
        </span>
      </button>

      {open && (
        <ul className="space-y-0.5 border-t border-ink-800 p-2">
          {items.map((i) => (
            <li
              key={i.key}
              className={cn(
                "flex items-start gap-2.5 rounded-lg px-2 py-1.5",
                !i.done && i.severity === "required" && "bg-ink-800/50"
              )}
            >
              <span className="mt-0.5 shrink-0">
                {i.done ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : i.severity === "required" ? (
                  <AlertCircle className="h-4 w-4 text-amber-400" />
                ) : (
                  <Circle className="h-4 w-4 text-zinc-600" />
                )}
              </span>
              <div className="min-w-0">
                <div
                  className={cn(
                    "text-sm",
                    i.done ? "text-zinc-500" : i.severity === "required" ? "text-zinc-200" : "text-zinc-400"
                  )}
                >
                  {i.label}
                  {!i.done && i.severity === "recommended" && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-zinc-600">
                      optional
                    </span>
                  )}
                </div>
                {/* The reason only earns its space while the item is still outstanding. */}
                {!i.done && <div className="text-xs leading-snug text-zinc-500">{i.why}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
