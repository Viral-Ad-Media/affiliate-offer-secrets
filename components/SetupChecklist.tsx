"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SetupStep = {
  key: string;
  label: string;
  /** Why this step matters — the thing a bare checklist never tells you. */
  hint: string;
  href: string;
  cta: string;
  done: boolean;
};

/**
 * The first-run setup checklist on Overview.
 *
 * Every step's `done` is computed from real rows by the page, never stored — see
 * 0073_workspace_setup_checklist.sql for why. The only persisted state is the dismissal.
 *
 * It hides itself once every step is done, rather than sitting there as a wall of ticks: a
 * checklist that has nothing left to ask for is just clutter on the page you look at most. The
 * explicit dismiss is for the other case — someone who deliberately isn't going to do a step
 * (plenty of people never connect a custom domain) and shouldn't be nagged about it forever.
 */
export default function SetupChecklist({
  steps,
  workspaceId,
}: {
  steps: SetupStep[];
  workspaceId: string;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);

  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  if (hidden || !next) return null;

  async function dismiss() {
    setHidden(true);
    await createClient().rpc("dismiss_workspace_setup", { p_workspace_id: workspaceId });
    router.refresh();
  }

  return (
    <Card as="section" className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Finish setting up</h2>
          <p className="text-xs text-zinc-500">
            {done} of {steps.length} done — these are the steps between a new account and a funnel
            that&apos;s actually taking leads.
          </p>
        </div>
        <button
          onClick={dismiss}
          title="Hide this checklist"
          className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-ink-800 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Progress is a plain bar rather than a ring: it's read at a glance and never the point of
          the panel — the next action is. */}
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full bg-emerald-500 transition-[width] duration-300"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>

      <ul className="space-y-1">
        {steps.map((s) => {
          const isNext = s.key === next.key;
          return (
            <li
              key={s.key}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-2",
                isNext && "bg-ink-800/60"
              )}
            >
              {s.done ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <Circle className={cn("h-4 w-4 shrink-0", isNext ? "text-zinc-300" : "text-zinc-600")} />
              )}
              <div className="min-w-0 flex-1">
                <div className={cn("text-sm", s.done ? "text-zinc-500 line-through" : "text-zinc-200")}>
                  {s.label}
                </div>
                {/* The hint only earns its space on the step you're actually being asked to do. */}
                {isNext && <div className="text-xs leading-snug text-zinc-500">{s.hint}</div>}
              </div>
              {isNext && (
                <Link href={s.href} className={cn(buttonVariants(), "shrink-0 text-xs")}>
                  {s.cta}
                </Link>
              )}
              {!s.done && !isNext && (
                <Link
                  href={s.href}
                  className="shrink-0 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                >
                  {s.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
