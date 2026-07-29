"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

// Reusable drag-handle wrapper for one reorderable content block, shared by PageEditor.tsx and
// FunnelStepEditor.tsx — both need the identical "grab the handle, drag the block" interaction
// around otherwise-independent field JSX, so this factors out the @dnd-kit wiring once rather
// than duplicating useSortable/transform/transition setup in both editors.
export default function SortableSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-ink-700 bg-ink-900/40 p-3"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none rounded p-1 text-zinc-500 hover:bg-ink-800 hover:text-zinc-200 active:cursor-grabbing"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</span>
      </div>
      {children}
    </div>
  );
}
