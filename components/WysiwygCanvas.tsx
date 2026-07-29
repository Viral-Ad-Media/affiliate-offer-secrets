"use client";

import { useCallback, useRef } from "react";
import { GripVertical, ImagePlus, Plus, X } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { resolveSectionOrder, type PageCopy, type SectionKey } from "@/lib/engine/renderPages";

// Fonts/sizes/colors below are hand-matched to the <style> block in lib/engine/renderPages.ts —
// this canvas IS the editor (no separate form-panel-plus-iframe split anymore), so drift here
// means the editor stops looking like what actually publishes. If that template's CSS changes,
// update this file in the same commit.
const PAGE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

// Sets the DOM node's text exactly once, at mount, then never touches it again on re-render (no
// children/dangerouslySetInnerHTML passed after that) — deliberately "uncontrolled" so editing a
// SIBLING field (which re-renders this whole tree) can never reset whatever the user is mid-typing
// here or move their cursor. onBlur is the only point this reads back out into React state, which
// keeps the underlying PageCopy shape (and therefore the save payload) unchanged from before this
// WYSIWYG rework — only how it's edited changed, not what's stored.
function EditableText({
  value,
  onCommit,
  as: Tag = "span",
  className,
  style,
  multiline = false,
  maxLength,
}: {
  value: string;
  onCommit: (v: string) => void;
  as?: any;
  className?: string;
  style?: React.CSSProperties;
  multiline?: boolean;
  maxLength?: number;
}) {
  const setRef = useCallback((el: HTMLElement | null) => {
    if (el) el.textContent = value;
    // Deliberately empty deps — this must run once at mount with whatever `value` was then, never
    // again on prop changes (see the note above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Tag
      ref={setRef}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e: React.FocusEvent<HTMLElement>) => {
        let text = e.currentTarget.textContent ?? "";
        if (maxLength && text.length > maxLength) {
          text = text.slice(0, maxLength);
          e.currentTarget.textContent = text;
        }
        onCommit(text);
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (!multiline && e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={`min-h-[1.2em] cursor-text rounded-sm outline-none focus:bg-emerald-50 focus:ring-1 focus:ring-emerald-300 ${className ?? ""}`}
      style={style}
    />
  );
}

function Section({ id, children }: { id: SectionKey; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative rounded-md border border-transparent px-1 py-1 hover:border-dashed hover:border-emerald-300"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        className="absolute -top-3 right-1 z-10 hidden h-6 w-6 cursor-grab items-center justify-center rounded bg-white text-gray-400 shadow ring-1 ring-gray-200 hover:text-emerald-600 active:cursor-grabbing group-hover:flex"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}

export type WysiwygCanvasProps = {
  copy: PageCopy;
  onChange: <K extends keyof PageCopy>(key: K, value: PageCopy[K]) => void;
  imageDataUrl: string | null;
  onImageFile: (file: File) => void;
  onImageRemove: () => void;
  imageBusy: boolean;
  productTitle: string;
  ctaClassName?: string;
  belowCta?: React.ReactNode;
};

// Shared visual surface for both components/PageEditor.tsx (opt-in page + bridge_variants) and
// components/FunnelStepEditor.tsx (funnel steps) — the "two-component-mirror" pattern this
// codebase already uses for those two files extends to this shared canvas rather than
// tripling the WYSIWYG/dnd-kit wiring a third time.
export default function WysiwygCanvas({
  copy,
  onChange,
  imageDataUrl,
  onImageFile,
  onImageRemove,
  imageBusy,
  productTitle,
  ctaClassName,
  belowCta,
}: WysiwygCanvasProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const fileRef = useRef<HTMLInputElement>(null);
  const sectionOrder = resolveSectionOrder(copy.sectionOrder);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sectionOrder.indexOf(active.id as SectionKey);
    const newIndex = sectionOrder.indexOf(over.id as SectionKey);
    onChange("sectionOrder", arrayMove(sectionOrder, oldIndex, newIndex));
  }

  function updateBenefit(i: number, value: string) {
    const next = [...copy.benefits];
    next[i] = value;
    onChange("benefits", next);
  }

  function updateFaq(i: number, field: "q" | "a", value: string) {
    onChange(
      "faq",
      copy.faq.map((f, idx) => (idx === i ? { ...f, [field]: value } : f))
    );
  }

  function renderSection(key: SectionKey) {
    switch (key) {
      case "lead":
        return (
          <div>
            <EditableText
              as="p"
              value={copy.lead}
              onCommit={(v) => onChange("lead", v)}
              maxLength={1000}
              multiline
              className="text-[18px] text-[#333]"
            />
            <div className="group/img relative mt-4">
              {imageDataUrl ? (
                <img src={imageDataUrl} alt={productTitle} className="max-w-full rounded-xl" />
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={imageBusy}
                  className="flex h-32 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-400 hover:border-emerald-400 hover:text-emerald-500"
                >
                  <ImagePlus className="h-4 w-4" /> {imageBusy ? "Processing…" : "Add an image"}
                </button>
              )}
              {imageDataUrl && (
                <div className="absolute inset-x-0 bottom-2 flex justify-center gap-2 opacity-0 transition-opacity group-hover/img:opacity-100">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={imageBusy}
                    className="rounded-lg bg-black/70 px-3 py-1.5 text-xs font-medium text-white hover:bg-black/85"
                  >
                    {imageBusy ? "Processing…" : "Replace"}
                  </button>
                  <button
                    type="button"
                    onClick={onImageRemove}
                    className="rounded-lg bg-black/70 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600/85"
                  >
                    Remove
                  </button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onImageFile(file);
                }}
              />
            </div>
          </div>
        );
      case "mechanism":
        return (
          <div>
            <h2 style={{ fontSize: 22, marginTop: 32, marginBottom: 8 }}>How it works</h2>
            <EditableText
              as="p"
              value={copy.mechanism}
              onCommit={(v) => onChange("mechanism", v)}
              maxLength={3000}
              multiline
            />
          </div>
        );
      case "benefits":
        return (
          <div>
            <h2 style={{ fontSize: 22, marginTop: 32, marginBottom: 8 }}>What you get</h2>
            <ul style={{ paddingLeft: 20 }}>
              {copy.benefits.map((b, i) => (
                <li key={i} className="group/item relative pr-6">
                  <EditableText value={b} onCommit={(v) => updateBenefit(i, v)} maxLength={300} />
                  <button
                    type="button"
                    onClick={() => onChange("benefits", copy.benefits.filter((_, idx) => idx !== i))}
                    title="Remove"
                    className="absolute right-0 top-0.5 hidden text-gray-400 hover:text-red-500 group-hover/item:block"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => onChange("benefits", [...copy.benefits, "New benefit"])}
              disabled={copy.benefits.length >= 10}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="h-3 w-3" /> Add benefit
            </button>
          </div>
        );
      case "proof":
        return (
          <EditableText as="p" value={copy.proof} onCommit={(v) => onChange("proof", v)} maxLength={1000} multiline />
        );
      case "faq":
        return (
          <div>
            <h2 style={{ fontSize: 22, marginTop: 32, marginBottom: 8 }}>Questions</h2>
            {copy.faq.map((f, i) => (
              <div key={i} className="group/item relative mb-4 pr-6">
                <EditableText
                  as="h3"
                  value={f.q}
                  onCommit={(v) => updateFaq(i, "q", v)}
                  maxLength={200}
                  className="mb-1 block text-[16px] font-semibold"
                />
                <EditableText as="p" value={f.a} onCommit={(v) => updateFaq(i, "a", v)} maxLength={1000} multiline />
                <button
                  type="button"
                  onClick={() => onChange("faq", copy.faq.filter((_, idx) => idx !== i))}
                  title="Remove"
                  className="absolute right-0 top-0 hidden text-gray-400 hover:text-red-500 group-hover/item:block"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onChange("faq", [...copy.faq, { q: "New question", a: "Answer" }])}
              disabled={copy.faq.length >= 10}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="h-3 w-3" /> Add question
            </button>
          </div>
        );
    }
  }

  return (
    <div
      className="mx-auto max-w-[680px] rounded-lg border border-ink-700 bg-white px-6 py-10 text-[#1a1a1a]"
      style={{ fontFamily: PAGE_FONT, lineHeight: 1.6 }}
    >
      <EditableText
        as="h1"
        value={copy.headline}
        onCommit={(v) => onChange("headline", v)}
        maxLength={200}
        className="mb-4 block text-[32px] font-bold leading-tight"
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
          <div>
            {sectionOrder.map((key) => (
              <Section key={key} id={key}>
                {renderSection(key)}
              </Section>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mx-auto mt-10 max-w-[420px] text-center">
        <EditableText
          as="span"
          value={copy.cta}
          onCommit={(v) => onChange("cta", v)}
          maxLength={60}
          className={
            ctaClassName ??
            "inline-block w-full rounded-lg bg-[#16a34a] px-8 py-4 text-[18px] font-semibold text-white hover:bg-[#15803d]"
          }
        />
      </div>

      {belowCta}
    </div>
  );
}
