import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Retuned from stock shadcn to reproduce this app's hand-rolled `.btn-*` classes exactly, so
 * migrating ~70 files of call sites is a visual no-op rather than a silent restyle. Stock shadcn
 * was `rounded-md`, `h-10 px-4 py-2` and `hover:bg-primary/90`; this app's `.btn` is
 * `rounded-lg`, `px-3 py-1.5` and a distinct hover *shade* (emerald-500), not an opacity fade.
 *
 * Colours are the same `ink-` and `emerald-` utilities globals.css used, not the semantic
 * bg-primary/bg-accent tokens. Those tokens are hand-mapped to the same values so either would
 * look right today, but the literals are what the classes being replaced actually emit — which
 * is the property that makes this pass reviewable. They're theme CSS variables underneath, so
 * light mode still works.
 *
 * Variant naming is the one place this doesn't map 1:1: `.btn-ghost` has a border, so it becomes
 * `outline` (shadcn's `ghost` is borderless). A real borderless `ghost` is added for the many
 * bare icon buttons in the app that currently hand-roll it.
 *
 * The focus ring is new — `.btn` had no focus style at all, so keyboard users got only the
 * browser default. It's the one deliberate visual change here, and only shows on keyboard focus.
 */
const buttonVariants = cva(
  // No whitespace-nowrap, despite stock shadcn having it: .btn didn't, so adding it would change
  // how long-labelled buttons wrap. The focus ring below is the only intentional addition.
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-medium ring-offset-background transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        // .btn-primary
        default: "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700",
        // .btn-ghost — bordered, despite the old name
        outline:
          "border border-ink-600 text-zinc-300 hover:border-ink-500 hover:bg-ink-800 hover:text-zinc-100",
        ghost: "text-zinc-400 hover:bg-ink-800 hover:text-zinc-100",
        secondary: "bg-ink-800 text-zinc-200 hover:bg-ink-700",
        destructive: "bg-red-600 text-white hover:bg-red-500 active:bg-red-700",
        link: "text-emerald-300 underline-offset-4 hover:underline",
      },
      size: {
        default: "px-3 py-1.5",
        sm: "px-2 py-1 text-xs",
        lg: "px-5 py-2.5",
        icon: "p-1.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
