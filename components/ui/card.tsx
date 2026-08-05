import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card — the shadcn primitive, retuned to render byte-identically to the hand-rolled `.card`
 * class in globals.css (`rounded-xl border border-ink-700 bg-ink-900`) so swapping call sites is
 * a visual no-op. ink-* are theme CSS variables, not fixed colours, so this stays correct in
 * light mode for the same reason `.card` did.
 *
 * `.card` carries no padding — every call site picks its own (`card p-4`, `card p-5`). That's
 * preserved: <Card className="p-4"> is the 1:1 swap. The Header/Content/Footer sub-components
 * are available for new work but nothing is required to use them.
 */
/**
 * `as` exists because a good number of these were <section>/<header>/<article> before the
 * migration. Card is cosmetic — a border and a background — and shouldn't cost a page its
 * document structure, so the element stays the caller's choice and only defaults to div.
 */
type CardProps = React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "header" | "footer" | "article" | "aside" | "li" | "label";
};

const Card = React.forwardRef<HTMLElement, CardProps>(({ className, as: Tag = "div", ...props }, ref) => (
  <Tag
    ref={ref as React.Ref<never>}
    className={cn("rounded-xl border border-ink-700 bg-ink-900", className)}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-5", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-sm font-semibold text-zinc-100", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-xs leading-snug text-zinc-500", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-5 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
