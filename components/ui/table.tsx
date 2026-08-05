import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Table — replaces the hand-rolled `.data-table` descendant selectors in globals.css.
 *
 * `.data-table` styled `thead th` and `tbody tr` from the parent, which meant the styling
 * applied to every row whether or not it wanted it, and a one-off row had to fight it with
 * overrides. Here the same rules live on the components that own them, so a row can opt out by
 * simply not using TableRow.
 *
 * The classes are lifted verbatim, including the quirk worth keeping: interior header cells get
 * tighter horizontal padding (px-2) than the first and last (px-4), so a table's outer edges
 * line up with the card padding around it while interior columns stay dense. That was
 * `th:not(:first-child):not(:last-child)` — expressed here as the TableHead default plus an
 * explicit `edge` prop, because a component can't see its own position.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cn("w-full border-collapse", className)} {...props} />
  )
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn(className)} {...props} />
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn(className)} {...props} />
);
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("border-b border-ink-800 transition-colors hover:bg-ink-800/40", className)}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

/** `edge` = first or last column: wider padding so the table lines up with its container. */
const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { edge?: boolean }
>(({ className, edge = false, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "border-b border-ink-700 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500",
      edge ? "px-4" : "px-2",
      className
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => <td ref={ref} className={cn(className)} {...props} />
);
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
