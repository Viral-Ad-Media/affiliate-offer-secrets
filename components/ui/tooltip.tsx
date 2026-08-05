"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/**
 * Tooltip, styled to match this app's popovers.
 *
 * Worth being deliberate about when to use it. The app already uses the native `title` attribute
 * in a lot of places, and native titles are not simply the worse option: they work without JS,
 * they don't move layout, and screen readers handle them predictably. What they're bad at is
 * anything you want a person to actually READ — the ~1s delay and OS-styled box mean a hint that
 * explains a non-obvious action mostly goes unseen.
 *
 * So: this is for controls whose purpose isn't guessable from the icon and where the explanation
 * genuinely helps (what a Regenerate will overwrite, why an action is disabled). Leave `title` on
 * the ones where the tooltip is just the label spelled out.
 *
 * Not a substitute for an accessible name — an icon-only button still needs aria-label. A tooltip
 * describes; it doesn't name.
 */
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-xs rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs leading-snug text-zinc-300 shadow-xl",
        "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * The common case in one component, so a hint costs one wrapper rather than four.
 * `delayDuration={200}` because the default 700ms is long enough that people move on first.
 */
export function Hint({
  children,
  content,
  side = "top",
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
