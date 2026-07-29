"use client";

import { useCallback, useRef, useState } from "react";
import {
  GripVertical,
  ImagePlus,
  Image as ImageIcon,
  Plus,
  X,
  Trash2,
  Monitor,
  Tablet,
  Smartphone,
  Heading1,
  Heading2,
  AlignLeft,
  List,
  ListChecks,
  Minus,
  Images,
  MousePointerClick,
  HelpCircle,
} from "lucide-react";
import { DndContext, closestCenter, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  newBlockId,
  updateBlockContent,
  removeChildBlock,
  addChildBlock,
  findBlockLocation,
  moveBlockToContainer,
  insertElement,
  insertRow,
  containerKey,
  parseContainerKey,
  ALLOWED_ICON_NAMES,
  ELEMENT_BLOCK_TYPES,
  type PageBlockTree,
  type SectionBlock,
  type RowBlock,
  type ColumnBlock,
  type ElementBlock,
  type LockedBlock,
  type FormInputBlock,
  type ContainerRef,
} from "@/lib/engine/renderPages";

type ElementBlockTypeLocal = (typeof ELEMENT_BLOCK_TYPES)[number];

// Matches the real page's <style> block in lib/engine/renderPages.ts — this canvas IS the editor
// (no separate form-panel-plus-iframe split), so drift here means the editor stops looking like
// what actually publishes. If that template's CSS changes, update this file in the same commit.
const PAGE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

// Desktop matches the real page's own `.wrap { max-width: 680px }` (lib/engine/renderPages.ts) —
// the actual published content column, not a full browser viewport. Tablet/mobile narrow that
// same column so a Row's `.row { flex-wrap: wrap }` columns (lib/engine/blockTree.ts) actually
// demonstrate stacking — purely a preview aid, not stored anywhere; it never affects what's saved
// or how the real page renders at a real width.
const DEVICE_WIDTHS: Record<"desktop" | "tablet" | "mobile", number> = { desktop: 680, tablet: 480, mobile: 360 };

const ELEMENT_PALETTE: { type: ElementBlockTypeLocal; label: string; icon: any }[] = [
  { type: "heading", label: "Heading", icon: Heading1 },
  { type: "subheading", label: "Subheading", icon: Heading2 },
  { type: "paragraph", label: "Paragraph", icon: AlignLeft },
  { type: "image", label: "Image", icon: ImageIcon },
  { type: "bullet_list", label: "Bullet list", icon: List },
  { type: "icon_list", label: "Icon list", icon: ListChecks },
  { type: "divider", label: "Divider", icon: Minus },
  { type: "image_list", label: "Image list", icon: Images },
  { type: "button", label: "Button", icon: MousePointerClick },
  { type: "faq_item", label: "FAQ item", icon: HelpCircle },
];

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

// Drag handle + delete for anything nested below root (a Row within a Section, or an element
// within a Section or a Column) — module-scope (not defined inside WysiwygCanvas's body) so its
// component identity is stable across renders; an inline nested-function definition would get a
// fresh identity on every WysiwygCanvas re-render (which happens on nearly every edit), forcing
// React to unmount/remount this subtree each time — breaking EditableText's mount-once pattern
// and any transient UI state (like AddBlockMenu's own open/closed toggle) beneath it.
function NestedItemWrapper({
  id,
  onDelete,
  deleteTitle,
  children,
}: {
  id: string;
  onDelete?: () => void;
  deleteTitle?: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group/nested relative mb-2 rounded-md border border-transparent px-1 py-0.5 hover:border-dashed hover:border-emerald-200"
    >
      <div className="absolute -left-1 -top-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover/nested:opacity-100">
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="Drag to reposition"
          className="flex h-5 w-5 cursor-grab items-center justify-center rounded bg-white text-gray-400 shadow ring-1 ring-gray-200 hover:text-emerald-600 active:cursor-grabbing"
        >
          <GripVertical className="h-3 w-3" />
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title={deleteTitle ?? "Delete"}
            className="flex h-5 w-5 items-center justify-center rounded bg-white text-gray-400 shadow ring-1 ring-gray-200 hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// The "+ Add block" control mounted at the end of every Section body and every Column body.
// `onPickRow` is only passed for Section-level menus (columns can't contain rows — no code path
// exists for it, matching the schema's ColumnBlock.children: ElementBlock[] shape) — its presence
// is what toggles the extra "Row" section of the menu on/off.
function AddBlockMenu({ onPick, onPickRow }: { onPick: (type: ElementBlockTypeLocal) => void; onPickRow?: (layout: RowBlock["layout"]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 hover:border-emerald-400 hover:text-emerald-600"
      >
        <Plus className="h-3.5 w-3.5" /> Add block
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
            {onPickRow && (
              <div className="mb-1 border-b border-gray-100 pb-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Row</div>
                <div className="flex gap-1 px-2 pb-1">
                  {(["1col", "2col", "3col"] as const).map((layout) => (
                    <button
                      key={layout}
                      type="button"
                      onClick={() => {
                        onPickRow(layout);
                        setOpen(false);
                      }}
                      className="flex-1 rounded border border-gray-200 py-1 text-[11px] text-gray-600 hover:border-emerald-400 hover:text-emerald-600"
                    >
                      {layout === "1col" ? "1 col" : layout === "2col" ? "2 col" : "3 col"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Element</div>
            <div className="max-h-56 overflow-y-auto">
              {ELEMENT_PALETTE.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    onPick(type);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-gray-700 hover:bg-emerald-50"
                >
                  <Icon className="h-3.5 w-3.5 text-gray-400" /> {label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type RenderElementFn = (el: ElementBlock, containerId: string) => React.ReactNode;

// A Row's single Column — its own drop zone (so an empty column is still a valid drag target) and
// its own SortableContext (elements reorder within it, or arrive from a different column/section
// via cross-container drag, handled centrally by WysiwygCanvas's handleDragEnd).
function ColumnEditor({
  col,
  rowId,
  colIndex,
  renderElement,
  onDeleteElement,
  onAddElement,
}: {
  col: ColumnBlock;
  rowId: string;
  colIndex: number;
  renderElement: RenderElementFn;
  onDeleteElement: (containerId: string, elementId: string) => void;
  onAddElement: (ref: ContainerRef, type: ElementBlockTypeLocal) => void;
}) {
  const ref: ContainerRef = { kind: "column", rowId, colIndex };
  const { setNodeRef } = useDroppable({ id: containerKey(ref) });
  return (
    <div ref={setNodeRef} className="min-h-[2.5rem] flex-1 rounded-md border border-dashed border-transparent p-0.5 hover:border-gray-200">
      <SortableContext items={col.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        {col.children.map((el) => (
          <NestedItemWrapper key={el.id} id={el.id} onDelete={() => onDeleteElement(col.id, el.id)}>
            {renderElement(el, col.id)}
          </NestedItemWrapper>
        ))}
      </SortableContext>
      <AddBlockMenu onPick={(type) => onAddElement(ref, type)} />
    </div>
  );
}

// A Row's columns, side by side. The row itself isn't a drop zone (it never directly holds
// elements — only its columns do) so no useDroppable here, only the per-column ones above.
function RowEditor({
  row,
  renderElement,
  onDeleteElement,
  onAddElement,
}: {
  row: RowBlock;
  renderElement: RenderElementFn;
  onDeleteElement: (containerId: string, elementId: string) => void;
  onAddElement: (ref: ContainerRef, type: ElementBlockTypeLocal) => void;
}) {
  return (
    <div className="flex gap-6">
      {row.columns.map((col, colIndex) => (
        <ColumnEditor
          key={col.id}
          col={col}
          rowId={row.id}
          colIndex={colIndex}
          renderElement={renderElement}
          onDeleteElement={onDeleteElement}
          onAddElement={onAddElement}
        />
      ))}
    </div>
  );
}

// A Section's body — its own drop zone plus a SortableContext over its direct children (a mix of
// Row and bare Element siblings, matching SectionBlock.children's real shape).
function SectionBody({
  section,
  renderElement,
  onDeleteChild,
  onAddElement,
  onAddRow,
}: {
  section: SectionBlock;
  renderElement: RenderElementFn;
  onDeleteChild: (containerId: string, childId: string) => void;
  onAddElement: (ref: ContainerRef, type: ElementBlockTypeLocal) => void;
  onAddRow: (sectionId: string, layout: RowBlock["layout"]) => void;
}) {
  const ref: ContainerRef = { kind: "section", sectionId: section.id };
  const { setNodeRef } = useDroppable({ id: containerKey(ref) });
  return (
    <div ref={setNodeRef}>
      <SortableContext items={section.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        {section.children.map((child) =>
          child.type === "row" ? (
            <NestedItemWrapper key={child.id} id={child.id} onDelete={() => onDeleteChild(section.id, child.id)} deleteTitle="Delete row">
              <RowEditor row={child} renderElement={renderElement} onDeleteElement={onDeleteChild} onAddElement={onAddElement} />
            </NestedItemWrapper>
          ) : (
            <NestedItemWrapper key={child.id} id={child.id} onDelete={() => onDeleteChild(section.id, child.id)}>
              {renderElement(child, section.id)}
            </NestedItemWrapper>
          )
        )}
      </SortableContext>
      <AddBlockMenu onPick={(type) => onAddElement(ref, type)} onPickRow={(layout) => onAddRow(section.id, layout)} />
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
// Phase O.3: nested drag-and-drop (elements between columns/sections, rows within a section) plus
// a full "+ Add block" element palette and Row/Column insertion (fixed 1/2/3-col presets, no
// drag-to-resize). Modeled as multiple dnd-kit sortable containers under one DndContext — root
// (Sections + locked blocks), one per Section body, one per Column body — rather than a single
// globally-flattened indented list, since this schema's containment is already a fixed, shallow
// shape (root -> section-child -> column-child). See lib/engine/blockTree.ts's
// findBlockLocation/moveBlockToContainer for the pure data-layer half of this.
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
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    // Root-level (Sections + locked blocks) — unchanged from Phase O.2, reorder within root only.
    const rootIds = tree.blocks.map((b) => b.id);
    if (rootIds.includes(activeId)) {
      if (!rootIds.includes(overId)) return;
      const oldIndex = rootIds.indexOf(activeId);
      const newIndex = rootIds.indexOf(overId);
      onChange({ ...tree, blocks: arrayMove(tree.blocks, oldIndex, newIndex) });
      return;
    }

    // Nested (a Row or an Element, anywhere below root). `overId` is either another block's id
    // (reorder/reparent to just before it) or a container's own droppable id (dropped on empty
    // space inside a Section/Column — append at the end; moveBlockToContainer clamps internally).
    const parsedContainer = parseContainerKey(overId);
    let targetRef: ContainerRef;
    let targetIndex: number;
    if (parsedContainer) {
      targetRef = parsedContainer;
      targetIndex = Number.MAX_SAFE_INTEGER;
    } else {
      const overLoc = findBlockLocation(tree, overId);
      if (!overLoc) return;
      targetRef = overLoc.ref;
      targetIndex = overLoc.index;
    }
    onChange(moveBlockToContainer(tree, activeId, targetRef, targetIndex));
  }

  function commit(blockId: string, patch: Record<string, unknown>) {
    onChange(updateBlockContent(tree, blockId, patch));
  }

  function deleteChild(containerId: string, childId: string) {
    onChange(removeChildBlock(tree, containerId, childId));
  }

  function addElement(ref: ContainerRef, type: ElementBlockTypeLocal) {
    onChange(insertElement(tree, ref, Number.MAX_SAFE_INTEGER, type));
  }

  function addRow(sectionId: string, layout: RowBlock["layout"]) {
    onChange(insertRow(tree, sectionId, Number.MAX_SAFE_INTEGER, layout));
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

  const renderElement: RenderElementFn = (el, containerId) => {
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
          <div className="mb-1 pr-2">
            <EditableText
              as="h3"
              value={el.content.question}
              onCommit={(v) => commit(el.id, { question: v })}
              maxLength={200}
              className="mb-1 block text-[16px] font-semibold"
            />
            <EditableText as="p" value={el.content.answer} onCommit={(v) => commit(el.id, { answer: v })} maxLength={1000} multiline />
          </div>
        );
    }
  };

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
                {b.type === "section" ? (
                  <SectionBody section={b} renderElement={renderElement} onDeleteChild={deleteChild} onAddElement={addElement} onAddRow={addRow} />
                ) : (
                  renderLockedBlock(b)
                )}
              </RootBlockWrapper>
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
