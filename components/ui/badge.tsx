import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge — replaces the hand-rolled `.chip`. The base is `.chip` verbatim
 * (`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium`), which
 * deliberately carries NO colours: every existing call site supplies its own
 * (`chip border-emerald-500/30 bg-emerald-500/15 text-emerald-300`).
 *
 * So `variant="none"` is the default and the exact 1:1 swap for a bare `.chip` — colours keep
 * coming from className, and nothing changes. The named variants below are the combos that
 * actually recur in the app today, added so repeat call sites can stop hand-writing three
 * colour utilities each. Reach for a variant when it matches; keep passing className when it
 * doesn't, rather than bending a colour to fit.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        none: "",
        neutral: "border-ink-600 bg-ink-800 text-zinc-400",
        success: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
        info: "border-sky-500/30 bg-sky-500/15 text-sky-300",
        warning: "border-amber-500/30 bg-amber-500/15 text-amber-300",
        danger: "border-red-500/30 bg-red-500/15 text-red-300",
      },
    },
    defaultVariants: { variant: "none" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = "Badge";

export { Badge, badgeVariants };
