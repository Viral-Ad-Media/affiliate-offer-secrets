"use client";

import { useCallback, useRef, useState } from "react";
import { GripVertical, ImagePlus, Plus, X, Monitor, Tablet, Smartphone } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  newBlockId,
  updateBlockContent,
  removeChildBlock,
  addChildBlock,
  ALLOWED_ICON_NAMES,
  type PageBlockTree,
  type SectionBlock,
  type RowBlock,
  type ColumnBlock,
  type ElementBlock,
  type LockedBlock,
  type FormInputBlock,
} from "@/lib/engine/renderPages";

// Matches the real page's <style> block in lib/engine/renderPages.ts — this canvas IS the editor
// (no separate form-panel-plus-iframe split), so drift here means the editor stops looking like
// what actually publishes. If that template's CSS changes, update this file in the same commit.
const PAGE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

// Desktop matches the real page's own `.wrap { max-width: 680px }` (lib/engine/renderPages.ts) —
// the actual published content column, not a full browser viewport. Tablet/mobile narrow that
// same column so a Row's `.row { flex-wrap: wrap }` columns (lib/engine/blockTree.ts) actually
// demonstrate stacking, once Row/Column insertion ships (Phase O.3) — purely a preview aid, not
// stored anywhere; it never affects what's saved or how the real page renders at a real width.
const DEVICE_WIDTHS: Record<"desktop" | "tablet" | "mobile", number> = { desktop: 680, tablet: 480, mobile: 360 };

// Sets the DOM node's text exactly once, at mount, then never touches it again on re-render (no
// children/dangerouslySetInnerHTML passed after that) — deliberately "uncontrolled" so editing a
// SIBLING field (which re-renders this whole tree) can never reset whatever the user is mid-typing
// here or move their cursor. onBlur is the only point this reads back out into React state.
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

function RootBlockWrapper({ id, children }: { id: string; children: React.ReactNode }) {
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
  tree: PageBlockTree;
  onChange: (tree: PageBlockTree) => void;
  resizeImageFile: (file: File) => Promise<string>;
  imageBusyBlockId: string | null;
  onImageBusyChange: (blockId: string | null) => void;
  onImageError: (message: string) => void;
  productTitle: string;
  ctaClassName?: string;
};

// Shared visual surface for both components/PageEditor.tsx (opt-in page + bridge_variants) and
// components/FunnelStepEditor.tsx (funnel steps) — the "two-component-mirror" pattern this
// codebase already uses for those two files extends to this shared canvas rather than tripling
// the WYSIWYG/dnd-kit wiring a third time.
//
// Phase O.2: this canvas now edits a real PageBlockTree (sections/rows/columns/elements + locked
// blocks) instead of the old fixed 5-section PageCopy. Drag-to-reorder is still top-level only
// (root Sections + locked blocks) — nested drag-and-drop between rows/columns/elements is
// Phase O.3. Legacy-converted trees have exactly one umbrella Section with no rows, so this
// mostly looks like the pre-Phase-O editor today; Row/Column insertion UI also lands in O.3.
export default function WysiwygCanvas({
  tree,
  onChange,
  resizeImageFile,
  imageBusyBlockId,
  onImageBusyChange,
  onImageError,
  productTitle,
  ctaClassName,
}: WysiwygCanvasProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = tree.blocks.map((b) => b.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange({ ...tree, blocks: arrayMove(tree.blocks, oldIndex, newIndex) });
  }

  function commit(blockId: string, patch: Record<string, unknown>) {
    onChange(updateBlockContent(tree, blockId, patch));
  }

  async function pickImage(blockId: string, file: File) {
    onImageBusyChange(blockId);
    try {
      const resized = await resizeImageFile(file);
      onChange(updateBlockContent(tree, blockId, { dataUrl: resized }));
    } catch (err: any) {
      onImageError(err?.message ?? "Could not process image");
    } finally {
      onImageBusyChange(null);
    }
  }

  function renderElement(el: ElementBlock, sectionId?: string): React.ReactNode {
    switch (el.type) {
      case "heading":
        return (
          <EditableText
            as="h1"
            value={el.content.text}
            onCommit={(v) => commit(el.id, { text: v })}
            maxLength={200}
            className="mb-4 block text-[32px] font-bold leading-tight"
          />
        );
      case "subheading":
        return (
          <EditableText
            as="h2"
            value={el.content.text}
            onCommit={(v) => commit(el.id, { text: v })}
            maxLength={200}
            className="mb-2 mt-8 block text-[22px] font-semibold"
          />
        );
      case "paragraph":
        return (
          <EditableText
            as="p"
            value={el.content.text}
            onCommit={(v) => commit(el.id, { text: v })}
            maxLength={3000}
            multiline
            style={el.style.fontSize ? undefined : { fontSize: 18, color: "#333" }}
          />
        );
      case "image":
        return (
          <div className="group/img relative">
            {el.content.dataUrl ? (
              <img src={el.content.dataUrl} alt={el.content.alt || productTitle} className="max-w-full rounded-xl" />
            ) : (
              <button
                type="button"
                onClick={() => fileRefs.current[el.id]?.click()}
                disabled={imageBusyBlockId === el.id}
                className="flex h-32 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-400 hover:border-emerald-400 hover:text-emerald-500"
              >
                <ImagePlus className="h-4 w-4" /> {imageBusyBlockId === el.id ? "Processing…" : "Add an image"}
              </button>
            )}
            {el.content.dataUrl && (
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-2 opacity-0 transition-opacity group-hover/img:opacity-100">
                <button
                  type="button"
                  onClick={() => fileRefs.current[el.id]?.click()}
                  disabled={imageBusyBlockId === el.id}
                  className="rounded-lg bg-black/70 px-3 py-1.5 text-xs font-medium text-white hover:bg-black/85"
                >
                  {imageBusyBlockId === el.id ? "Processing…" : "Replace"}
                </button>
                <button
                  type="button"
                  onClick={() => commit(el.id, { dataUrl: null })}
                  className="rounded-lg bg-black/70 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600/85"
                >
                  Remove
                </button>
              </div>
            )}
            <input
              ref={(r) => {
                fileRefs.current[el.id] = r;
              }}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) pickImage(el.id, file);
              }}
            />
          </div>
        );
      case "bullet_list":
        return (
          <div>
            <ul style={{ paddingLeft: 20 }}>
              {el.content.items.map((item, i) => (
                <li key={i} className="group/item relative pr-6">
                  <EditableText
                    value={item}
                    onCommit={(v) => {
                      const next = [...el.content.items];
                      next[i] = v;
                      commit(el.id, { items: next });
                    }}
                    maxLength={300}
                  />
                  <button
                    type="button"
                    onClick={() => commit(el.id, { items: el.content.items.filter((_, idx) => idx !== i) })}
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
              onClick={() => commit(el.id, { items: [...el.content.items, "New item"] })}
              disabled={el.content.items.length >= 10}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="h-3 w-3" /> Add item
            </button>
          </div>
        );
      case "icon_list":
        return (
          <div>
            {el.content.items.map((item, i) => (
              <div key={i} className="group/item mb-2 flex items-center gap-2 pr-6">
                <select
                  value={item.icon}
                  onChange={(e) => {
                    const next = [...el.content.items];
                    next[i] = { ...next[i], icon: e.target.value };
                    commit(el.id, { items: next });
                  }}
                  className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs"
                >
                  {ALLOWED_ICON_NAMES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <div className="flex-1">
                  <EditableText
                    value={item.text}
                    onCommit={(v) => {
                      const next = [...el.content.items];
                      next[i] = { ...next[i], text: v };
                      commit(el.id, { items: next });
                    }}
                    maxLength={1000}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => commit(el.id, { items: el.content.items.filter((_, idx) => idx !== i) })}
                  className="hidden text-gray-400 hover:text-red-500 group-hover/item:block"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => commit(el.id, { items: [...el.content.items, { icon: ALLOWED_ICON_NAMES[0], text: "New item" }] })}
              disabled={el.content.items.length >= 10}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="h-3 w-3" /> Add icon item
            </button>
          </div>
        );
      case "divider":
        return <hr className="my-4 border-t border-gray-200" />;
      case "image_list":
        return (
          <div>
            {el.content.items.map((item, i) => (
              <div key={i} className="group/item mb-3 flex items-center gap-3 pr-6">
                {item.imageDataUrl ? (
                  <img src={item.imageDataUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-gray-300">
                    <ImagePlus className="h-4 w-4 text-gray-300" />
                  </div>
                )}
                <div className="flex-1">
                  <EditableText
                    value={item.caption}
                    onCommit={(v) => {
                      const next = [...el.content.items];
                      next[i] = { ...next[i], caption: v };
                      commit(el.id, { items: next });
                    }}
                    maxLength={1000}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => commit(el.id, { items: el.content.items.filter((_, idx) => idx !== i) })}
                  className="hidden text-gray-400 hover:text-red-500 group-hover/item:block"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => commit(el.id, { items: [...el.content.items, { imageDataUrl: null, caption: "New item" }] })}
              disabled={el.content.items.length >= 10}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="h-3 w-3" /> Add row
            </button>
          </div>
        );
      case "button":
        return (
          <div className="my-2">
            <EditableText
              as="span"
              value={el.content.text}
              onCommit={(v) => commit(el.id, { text: v })}
              maxLength={60}
              className="inline-block rounded-lg bg-[#16a34a] px-6 py-3 text-[15px] font-semibold text-white"
            />
            <input
              type="url"
              defaultValue={el.content.href}
              onBlur={(e) => commit(el.id, { href: e.target.value })}
              placeholder="https://example.com"
              className="mt-1 block w-full max-w-xs rounded border border-gray-300 px-2 py-1 text-xs text-gray-600"
            />
          </div>
        );
      case "faq_item":
        return (
          <div className="group/item relative mb-4 pr-6">
            <EditableText
              as="h3"
              value={el.content.question}
              onCommit={(v) => commit(el.id, { question: v })}
              maxLength={200}
              className="mb-1 block text-[16px] font-semibold"
            />
            <EditableText as="p" value={el.content.answer} onCommit={(v) => commit(el.id, { answer: v })} maxLength={1000} multiline />
            <button
              type="button"
              onClick={() => sectionId && onChange(removeChildBlock(tree, sectionId, el.id))}
              title="Remove"
              className="absolute right-0 top-0 hidden text-gray-400 hover:text-red-500 group-hover/item:block"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
    }
  }

  function renderColumn(col: ColumnBlock) {
    return (
      <div key={col.id} className="flex-1">
        {col.children.map((el) => (
          <div key={el.id} className="mb-2">
            {renderElement(el, col.id)}
          </div>
        ))}
      </div>
    );
  }

  function renderSectionChild(child: RowBlock | ElementBlock, sectionId: string) {
    if (child.type === "row") {
      return (
        <div key={child.id} className="mb-2 flex gap-6">
          {child.columns.map((c) => renderColumn(c))}
        </div>
      );
    }
    return (
      <div key={child.id} className="mb-2">
        {renderElement(child, sectionId)}
      </div>
    );
  }

  function renderSection(section: SectionBlock) {
    const hasFaq = section.children.some((c) => c.type === "faq_item");
    return (
      <div>
        {section.children.map((c) => renderSectionChild(c, section.id))}
        {hasFaq && (
          <button
            type="button"
            onClick={() =>
              onChange(
                addChildBlock(tree, section.id, {
                  id: newBlockId(),
                  type: "faq_item",
                  style: {},
                  content: { question: "New question", answer: "Answer" },
                })
              )
            }
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
          >
            <Plus className="h-3 w-3" /> Add FAQ item
          </button>
        )}
      </div>
    );
  }

  function renderFormField(field: FormInputBlock, formId: string) {
    return (
      <div key={field.id} className="group/item relative mb-2 flex items-center gap-2 pr-6">
        <EditableText
          value={field.content.label}
          onCommit={(v) => commit(field.id, { label: v })}
          maxLength={100}
          className="flex-1 rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-[13px] text-gray-500"
        />
        <select
          value={field.content.fieldType}
          onChange={(e) => commit(field.id, { fieldType: e.target.value })}
          className="rounded border border-gray-300 bg-white px-1 py-1 text-xs"
        >
          <option value="text">text</option>
          <option value="email">email</option>
          <option value="tel">phone</option>
        </select>
        <button
          type="button"
          onClick={() => onChange(removeChildBlock(tree, formId, field.id))}
          className="hidden text-gray-400 hover:text-red-500 group-hover/item:block"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  function renderLockedBlock(block: LockedBlock) {
    switch (block.locked) {
      case "disclosure":
        return (
          <p className="text-[11px] text-gray-400">
            Affiliate disclosure — locked, always shown at the bottom of the page.
          </p>
        );
      case "lead_capture_form":
        return (
          <div className="mx-auto max-w-[420px] rounded-xl border border-[#e5e5e5] bg-gray-50 p-6">
            <div className="mb-3 space-y-2">
              <div className="rounded-lg border border-gray-300 bg-white px-3.5 py-3 text-[13px] text-gray-400">First name (required, locked)</div>
              <div className="rounded-lg border border-gray-300 bg-white px-3.5 py-3 text-[13px] text-gray-400">Email address (required, locked)</div>
              {block.children.map((f) => renderFormField(f, block.id))}
            </div>
            <button
              type="button"
              onClick={() =>
                onChange(
                  addChildBlock(tree, block.id, {
                    id: newBlockId(),
                    type: "form_input",
                    style: {},
                    content: { label: "New field", fieldKey: newBlockId(), fieldType: "text", placeholder: "", required: false },
                  } as FormInputBlock)
                )
              }
              disabled={block.children.length >= 10}
              className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="h-3 w-3" /> Add form field
            </button>
            <EditableText
              as="div"
              value={block.content.ctaText}
              onCommit={(v) => commit(block.id, { ctaText: v })}
              maxLength={60}
              className="block rounded-lg bg-[#16a34a] px-8 py-3.5 text-center text-[15px] font-semibold text-white"
            />
          </div>
        );
      case "primary_cta":
        return (
          <div className="mx-auto max-w-[420px] text-center">
            <EditableText
              as="span"
              value={block.content.text}
              onCommit={(v) => commit(block.id, { text: v })}
              maxLength={60}
              className={
                ctaClassName ??
                "inline-block w-full rounded-lg bg-[#16a34a] px-8 py-4 text-[18px] font-semibold text-white hover:bg-[#15803d]"
              }
            />
          </div>
        );
      case "decline_link":
        return (
          <p className="text-center">
            <EditableText
              as="span"
              value={block.content.text}
              onCommit={(v) => commit(block.id, { text: v })}
              maxLength={60}
              className="text-[13px] text-gray-500 underline"
            />
          </p>
        );
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-center gap-1">
        {(
          [
            ["desktop", Monitor, "Desktop"],
            ["tablet", Tablet, "Tablet"],
            ["mobile", Smartphone, "Mobile"],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setDevice(key)}
            title={label}
            className={`rounded-md p-1.5 ${
              device === key ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:bg-ink-800 hover:text-zinc-300"
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
      <div
        className="mx-auto rounded-lg border border-ink-700 bg-white px-6 py-10 text-[#1a1a1a] transition-[max-width] duration-200"
        style={{ fontFamily: PAGE_FONT, lineHeight: 1.6, maxWidth: DEVICE_WIDTHS[device] }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tree.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {tree.blocks.map((b) => (
              <RootBlockWrapper key={b.id} id={b.id}>
                {b.type === "section" ? renderSection(b) : renderLockedBlock(b)}
              </RootBlockWrapper>
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
