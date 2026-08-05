import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The "nothing here yet" panel.
 *
 * Not a new pattern — Funnels and Ads already did this well (icon, what's missing, what to do
 * about it, with the next step as a real link). Several other surfaces had drifted to a bare
 * sentence stating the fact and nothing else. This lifts the good version out so the difference
 * between the two stops being a matter of which page you happen to land on.
 *
 * The rule the component encodes: an empty screen is the one moment you know exactly what the
 * person is trying to do and hasn't managed yet, so it should always answer "what now" — hence
 * `children` (the explanation) is required, and `action` exists to make the next step clickable
 * rather than merely named.
 */
export default function EmptyState({
  icon: Icon,
  title,
  action,
  compact = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: { href: string; label: string };
  /** Tighter padding for a panel nested inside another card, where the full height is too much. */
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("px-4 text-center", compact ? "py-8" : "py-14")}>
      <Icon className="mx-auto mb-2.5 h-7 w-7 text-zinc-600" />
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-600">{children}</p>
      {action && (
        <Link href={action.href} className={cn(buttonVariants(), "mt-4 text-xs")}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
