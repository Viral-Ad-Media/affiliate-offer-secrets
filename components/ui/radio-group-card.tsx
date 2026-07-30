"use client";

// From 21st.dev: @ruixen.ui/radio-group-card (fetched via the 21st MCP connector, same pattern
// as data-table-filter.tsx / tabs.tsx). Card-based radio group — each option is a bordered card
// with icon/title/description and a glowing dot on the checked one. One on-theme adjustment from
// the original: the checked border uses this app's emerald accent instead of a hardcoded
// border-gray-400 (everything else already lands on-theme via the semantic-token mapping in
// globals.css).

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as React from "react";
import { cn } from "@/lib/utils";

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-4 sm:grid-cols-2", className)} {...props} />
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioCard = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & {
    title: string;
    description?: string;
    icon?: React.ReactNode;
  }
>(({ className, title, description, icon, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left shadow-sm transition-all",
      "hover:shadow-md",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
      "data-[state=checked]:border-emerald-500/50 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-3">
      {icon && <span className="text-primary">{icon}</span>}
      <span className="font-semibold">{title}</span>
    </div>
    {description && <p className="text-sm text-muted-foreground">{description}</p>}

    <RadioGroupPrimitive.Indicator className="absolute right-3 top-3">
      <span className="relative flex size-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75"></span>
        <span className="relative inline-flex size-3 rounded-full bg-green-500 shadow-[0_0_6px_2px_rgba(34,197,94,0.6)]"></span>
      </span>
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioCard.displayName = "RadioCard";

export { RadioGroup, RadioCard };
