"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  Video,
  HelpCircle,
  Quote,
  GalleryHorizontal,
  Timer,
  TextCursorInput,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  Columns2,
  Lock,
} from "lucide-react";
import { DndContext, closestCenter, useDroppable, useDraggable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  newBlockId,
  updateBlockContent,
  updateBlockStyle,
  removeChildBlock,
  addChildBlock,
  findBlockLocation,
  moveBlockToContainer,
  insertElement,
  insertRow,
  insertFormInput,
  FORM_FIELD_PRESETS,
  containerKey,
  parseContainerKey,
  ALLOWED_ICON_NAMES,
  ELEMENT_BLOCK_TYPES,
  styleToInlineCss,
  contentWidthOf,
  STYLE_KEYS_BY_TYPE,
  type PageBlockTree,
  type SectionBlock,
  type RowBlock,
  type ColumnBlock,
  type ElementBlock,
  type LockedBlock,
  type FormInputBlock,
  type FormFieldType,
  CHOICE_FIELD_TYPES,
  TESTIMONIAL_MEDIA_KINDS,
  type ContainerRef,
  type Block,
  type BlockStyle,
  type ButtonAction,
} from "@/lib/engine/renderPages";
import { parseVideoUrl, sourceToDisplayUrl, embedUrl } from "@/lib/engine/videoEmbed";
import BlockStylePanel from "@/components/BlockStylePanel";
import BlockSettingsPanel, { hasContentSettings } from "@/components/BlockSettingsPanel";
import EditorSidePanel from "@/components/EditorSidePanel";

// What the per-field dropdown offers. Labelled for humans ("Phone", not "tel") but valued with
// the exact schema strings, so the editor and the renderer can't drift.
const FIELD_TYPE_LABELS: { value: FormFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "tel", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "url", label: "URL" },
  { value: "textarea", label: "Paragraph" },
  { value: "checkbox", label: "Checkbox" },
  { value: "radio", label: "Radio" },
  { value: "select", label: "Dropdown" },
];

// One-click presets for the fields people actually ask for. These are ordinary form_input blocks
// with a sensible label/key/type already filled in — the point is that adding "Last name" doesn't
// mean typing a label, choosing a type and inventing a key by hand.
//
// First name and email are NOT here: those two are rendered by the form itself and can't be
// removed or edited, so offering them would create a duplicate that quietly overwrites the real one.
const FIELD_PRESETS: {
  label: string;
  fieldKey: string;
  fieldType: FormFieldType;
  placeholder?: string;
}[] = [
  { label: "Last name", fieldKey: "last_name", fieldType: "text", placeholder: "Last name" },
  { label: "Full name", fieldKey: "full_name", fieldType: "text", placeholder: "Full name" },
  { label: "Phone", fieldKey: "phone", fieldType: "tel", placeholder: "Phone number" },
  { label: "Second email", fieldKey: "alt_email", fieldType: "email", placeholder: "Email address" },
  { label: "Message", fieldKey: "message", fieldType: "textarea", placeholder: "Your message" },
  { label: "Checkbox", fieldKey: "consent", fieldType: "checkbox" },
  { label: "Choose one", fieldKey: "choice", fieldType: "radio" },
  { label: "Dropdown", fieldKey: "dropdown", fieldType: "select", placeholder: "Select one…" },
];

// Field keys are the CSV column headers and the JSON keys in contacts.extra_fields, so they have
// to be unique within a form — two "phone" fields would silently overwrite each other on submit.
function uniqueFieldKey(base: string, existing: FormInputBlock[]): string {
  const taken = new Set(existing.map((f) => f.content.fieldKey));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 50; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

// Converts the same trusted CSS string styleToInlineCss() produces for the real published page
// into a React inline-style object, so the canvas preview reflects a block's own custom style —
// not just what gets saved. Reusing styleToInlineCss (rather than re-deriving the per-key
// clamping logic here) means the two can never drift: whatever the panel lets you set and the
// server persists is exactly what both the real page AND this preview render.
function cssStringToReactStyle(css: string): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const rule of css.split(";")) {
    const idx = rule.indexOf(":");
    if (idx === -1) continue;
    const prop = rule.slice(0, idx).trim();
    const value = rule.slice(idx + 1).trim();
    if (!prop || !value) continue;
    style[prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return style as React.CSSProperties;
}

function blockInlineStyle(block: { type: string; style: BlockStyle }): React.CSSProperties {
  const allowed = (STYLE_KEYS_BY_TYPE as Record<string, readonly (keyof BlockStyle)[]>)[block.type] ?? [];
  return cssStringToReactStyle(styleToInlineCss(block.style, allowed));
}

type ElementBlockTypeLocal = (typeof ELEMENT_BLOCK_TYPES)[number];
// The palette offers Input, which is NOT an ElementBlockType — a form_input only ever exists as a
// child of a form, so it is inserted through insertFormInput rather than insertElement.
type PaletteType = ElementBlockTypeLocal | "form_input";

// Matches the real page's <style> block in lib/engine/renderPages.ts — this canvas IS the editor
// (no separate form-panel-plus-iframe split), so drift here means the editor stops looking like
// what actually publishes. If that template's CSS changes, update this file in the same commit.
const PAGE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

// Desktop matches the real page's own `.wrap { max-width: 680px }` (lib/engine/renderPages.ts) —
// the actual published content column, not a full browser viewport. Tablet/mobile narrow that
// same column so a Row's `.row { flex-wrap: wrap }` columns (lib/engine/blockTree.ts) actually
// demonstrate stacking — purely a preview aid, not stored anywhere; it never affects what's saved
// or how the real page renders at a real width.
// Desktop fills whatever width the editor's centre column gives it (Elementor-style) — the
// tablet/mobile presets stay pinned to real device widths, which is what the toggle is for.
// Fidelity note: the PUBLISHED page still renders inside its own max-width container
// (lib/engine/renderPages.ts), so a very wide monitor shows longer lines here than a visitor
// gets — switch to Tablet to check real line lengths.
const DEVICE_WIDTHS: Record<"desktop" | "tablet" | "mobile", number | string> = {
  desktop: "100%",
  tablet: 480,
  mobile: 360,
};

const ELEMENT_PALETTE: { type: PaletteType; label: string; icon: any }[] = [
  { type: "heading", label: "Heading", icon: Heading1 },
  { type: "subheading", label: "Subheading", icon: Heading2 },
  { type: "paragraph", label: "Paragraph", icon: AlignLeft },
  { type: "image", label: "Image", icon: ImageIcon },
  { type: "bullet_list", label: "Bullet list", icon: List },
  { type: "icon_list", label: "Icon list", icon: ListChecks },
  { type: "divider", label: "Divider", icon: Minus },
  { type: "image_list", label: "Image list", icon: Images },
  { type: "button", label: "Button", icon: MousePointerClick },
  { type: "video", label: "Video", icon: Video },
  { type: "faq_item", label: "FAQ item", icon: HelpCircle },
  { type: "testimonial", label: "Testimonial", icon: Quote },
  { type: "carousel", label: "Carousel", icon: GalleryHorizontal },
  { type: "countdown", label: "Countdown", icon: Timer },
  { type: "form_input", label: "Input", icon: TextCursorInput },
];

/**
 * Why each locked block can't be deleted, shown on its padlock. These four are rebuilt by
 * validatePageBlockTree on every save regardless, so a delete button would be a lie — but the
 * reason should be readable rather than left for someone to work out from a missing control.
 */
const LOCKED_REASONS: Record<string, string> = {
  disclosure: "The affiliate disclosure is required on every page and always renders last.",
  lead_capture_form: "This is the page's opt-in form — delete it and the funnel can't capture a lead.",
  primary_cta: "This is the button that sends visitors to the offer.",
  decline_link: "An upsell has to offer a visible way to decline.",
};

// A human-readable name for one block, for the button-action target dropdowns. Prefers the block's
// own text so a page with four headings doesn't offer four entries called "Heading".
/**
 * A form's fields are the one part of the tree `findBlockLocation` deliberately doesn't walk — a
 * form_input is never a drop target and never independently stylable, so nothing else needed to
 * resolve one. Its settings panel does, hence a second, narrower lookup rather than widening the
 * shared locator and changing what every drag/move call site sees.
 */
function findFormInputBlock(tree: PageBlockTree, id: string): FormInputBlock | null {
  const inForm = (b: Block): FormInputBlock | null => {
    const kids = (b as { children?: FormInputBlock[] }).children;
    if (!Array.isArray(kids)) return null;
    return kids.find((f) => f.id === id) ?? null;
  };
  const scan = (blocks: Block[]): FormInputBlock | null => {
    for (const b of blocks) {
      const hit = inForm(b);
      if (hit) return hit;
      if (b.type === "section") {
        const s = scan(b.children as Block[]);
        if (s) return s;
      } else if (b.type === "row") {
        for (const col of b.columns) {
          const c = scan(col.children as Block[]);
          if (c) return c;
        }
      }
    }
    return null;
  };
  return scan(tree.blocks as Block[]);
}

function blockLabel(b: Block): string {
  if (b.type === "section") return "Section";
  if (b.type === "row") return "Row";
  if ((b as LockedBlock).locked === "lead_capture_form") return "Opt-in form";
  if ((b as LockedBlock).locked === "primary_cta") return "Main CTA button";
  if ((b as LockedBlock).locked === "disclosure") return "Disclosure";
  if ((b as LockedBlock).locked === "decline_link") return "Decline link";
  const typeLabel = ELEMENT_PALETTE.find((p) => p.type === b.type)?.label ?? b.type;
  const c = (b as ElementBlock).content as Record<string, unknown>;
  const text = typeof c?.text === "string" ? c.text : typeof c?.title === "string" ? c.title : "";
  const trimmed = text.trim();
  return trimmed ? `${typeLabel} — ${trimmed.slice(0, 32)}` : typeLabel;
}

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
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  as?: any;
  className?: string;
  style?: React.CSSProperties;
  multiline?: boolean;
  maxLength?: number;
  /** Shown via CSS ::before while empty. An empty contentEditable collapses to a caret-sized
   *  target nobody can find — which is exactly the state a freshly-inserted block starts in. */
  placeholder?: string;
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
      data-placeholder={placeholder}
      className={`min-h-[1.2em] cursor-text rounded-sm outline-none empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)] focus:bg-emerald-50 focus:ring-1 focus:ring-emerald-300 ${className ?? ""}`}
      style={style}
    />
  );
}

function RootBlockWrapper({
  id,
  isSelected,
  onSelect,
  onDelete,
  lockedReason,
  children,
}: {
  id: string;
  isSelected?: boolean;
  onSelect?: () => void;
  /** Absent for the locked compliance blocks — see lockedReason. */
  onDelete?: () => void;
  /**
   * Why this block has no delete button. Rendered as a padlock rather than nothing: a control that
   * is simply missing reads as a bug, and "I can't delete this" was exactly the report that led
   * here. Locked blocks stay undeletable — the validator rebuilds them anyway — but silence about
   * it is what made that feel broken.
   */
  lockedReason?: string;
  children: React.ReactNode;
}) {
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
      onClick={
        onSelect &&
        ((e) => {
          e.stopPropagation();
          onSelect();
        })
      }
      className={`group relative rounded-md border px-1 py-1 hover:border-dashed hover:border-emerald-300 ${
        isSelected ? "border-emerald-400" : "border-transparent"
      }`}
    >
      {/* Hover-revealed controls, at the block's side (top-right edge) — never below it. */}
      <div className="absolute -top-3 right-1 z-10 hidden gap-0.5 group-hover:flex">
        {onSelect && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            title="Block settings"
            className="flex h-6 w-6 items-center justify-center rounded bg-white text-gray-400 shadow ring-1 ring-gray-200 hover:text-emerald-600"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          className="flex h-6 w-6 cursor-grab items-center justify-center rounded bg-white text-gray-400 shadow ring-1 ring-gray-200 hover:text-emerald-600 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete this section"
            className="flex h-6 w-6 items-center justify-center rounded bg-white text-gray-400 shadow ring-1 ring-gray-200 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : lockedReason ? (
          <span
            title={lockedReason}
            className="flex h-6 w-6 cursor-help items-center justify-center rounded bg-white text-gray-300 shadow ring-1 ring-gray-200"
          >
            <Lock className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// Same hover/select affordance as RootBlockWrapper, minus the drag handle — for the appendix,
// which has a fixed position on the real page and so must not look reorderable.
function StaticBlockWrapper({
  isSelected,
  onSelect,
  children,
}: {
  isSelected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`group relative rounded-md border px-1 py-1 hover:border-dashed hover:border-emerald-300 ${
        isSelected ? "border-emerald-400" : "border-transparent"
      }`}
    >
      <div className="absolute -top-3 right-1 z-10 hidden gap-0.5 group-hover:flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          title="Block settings"
          className="flex h-6 w-6 items-center justify-center rounded bg-white text-gray-400 shadow ring-1 ring-gray-200 hover:text-emerald-600"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </div>
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
  isSelected,
  onSelect,
  children,
}: {
  id: string;
  onDelete?: () => void;
  deleteTitle?: string;
  isSelected?: boolean;
  onSelect?: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={
        onSelect &&
        ((e) => {
          e.stopPropagation();
          onSelect();
        })
      }
      className={`group/nested relative mb-2 rounded-md border px-1 py-0.5 hover:border-dashed hover:border-emerald-200 ${
        isSelected ? "border-emerald-400" : "border-transparent"
      }`}
    >
      {/* Hover-revealed controls at the block's side (top-left edge) — never below it. */}
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
        {onSelect && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            title="Block settings"
            className="flex h-5 w-5 items-center justify-center rounded bg-white text-gray-400 shadow ring-1 ring-gray-200 hover:text-emerald-600"
          >
            <Settings2 className="h-3 w-3" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
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
function AddBlockMenu({ onPick, onPickRow }: { onPick: (type: PaletteType) => void; onPickRow?: (layout: RowBlock["layout"]) => void }) {
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

// The editor's own collapsible left rail of reusable block elements — the Elementor-style
// counterpart to the inline "+ Add block" popovers (which stay, for position-specific inserts).
// Clicking a palette item appends to wherever the current selection points (the selected
// section/column, or the container holding the selected element), falling back to the last
// section. Collapse state persists in localStorage, same pattern as the app sidebar.
// A palette entry is BOTH draggable and clickable, and the existing PointerSensor
// (activationConstraint: {distance: 4}) is what makes that work: a press that never moves stays a
// click, so click-to-append keeps behaving exactly as before while a drag past 4px starts an
// insert-at-drop-point instead.
//
// The id encodes what to create ("palette-el:heading", "palette-row:2col"). handleDragEnd reads it
// rather than carrying a data payload, so there is one place that decides what a drag id means.
function PaletteDraggable({
  id,
  children,
  ...rest
}: { id: string; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...rest}
      {...listeners}
      {...attributes}
      className={`${rest.className ?? ""} ${isDragging ? "opacity-40" : ""} cursor-grab active:cursor-grabbing`}
    >
      {children}
    </button>
  );
}

function EditorPalette({
  onPick,
  onPickRow,
}: {
  onPick: (type: PaletteType) => void;
  onPickRow: (layout: RowBlock["layout"]) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("editor_palette_collapsed") === "1");
  }, []);

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem("editor_palette_collapsed", c ? "0" : "1");
      return !c;
    });
  }

  return (
    <aside
      className={`sticky top-16 hidden max-h-[calc(100vh-5rem)] shrink-0 flex-col overflow-y-auto rounded-lg border border-ink-700 bg-ink-900/60 p-2 lg:flex ${
        collapsed ? "w-12" : "w-52"
      } transition-[width] duration-200`}
    >
      <div className={`mb-1 flex items-center ${collapsed ? "justify-center" : "justify-between px-1"}`}>
        {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Blocks</span>}
        <button
          onClick={toggle}
          title={collapsed ? "Expand blocks" : "Collapse blocks"}
          className="rounded p-1 text-zinc-500 hover:bg-ink-800 hover:text-zinc-200"
        >
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>
      </div>

      {!collapsed && <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Rows</div>}
      <div className={collapsed ? "flex flex-col gap-0.5" : "mb-2 flex gap-1 px-1"}>
        {(["1col", "2col", "3col"] as const).map((layout) => (
          <PaletteDraggable
            key={layout}
            id={`palette-row:${layout}`}
            onClick={() => onPickRow(layout)}
            title={`Drag onto the page, or click to add a ${layout === "1col" ? "1-column" : layout === "2col" ? "2-column" : "3-column"} row at the end`}
            className={
              collapsed
                ? "flex items-center justify-center rounded p-1.5 text-zinc-400 hover:bg-ink-800 hover:text-emerald-300"
                : "flex-1 rounded border border-ink-600 py-1 text-[11px] text-zinc-400 hover:border-emerald-500 hover:text-emerald-300"
            }
          >
            {collapsed ? <Columns2 className="h-4 w-4" /> : layout === "1col" ? "1 col" : layout === "2col" ? "2 col" : "3 col"}
          </PaletteDraggable>
        ))}
      </div>

      {!collapsed && <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Elements</div>}
      <div className="flex flex-col gap-0.5">
        {ELEMENT_PALETTE.map(({ type, label, icon: Icon }) => (
          <PaletteDraggable
            key={type}
            id={`palette-el:${type}`}
            onClick={() => onPick(type)}
            title={`${label} — drag onto the page, or click to add it at the end`}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-ink-800 hover:text-emerald-300 ${
              collapsed ? "justify-center px-1" : ""
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            {!collapsed && label}
          </PaletteDraggable>
        ))}
      </div>
    </aside>
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
  selectedBlockId,
  onSelectBlock,
}: {
  col: ColumnBlock;
  rowId: string;
  colIndex: number;
  renderElement: RenderElementFn;
  onDeleteElement: (containerId: string, elementId: string) => void;
  onAddElement: (ref: ContainerRef, type: PaletteType) => void;
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
}) {
  const ref: ContainerRef = { kind: "column", rowId, colIndex };
  const { setNodeRef } = useDroppable({ id: containerKey(ref) });
  return (
    <div
      ref={setNodeRef}
      className="min-h-[2.5rem] flex-1 rounded-md border border-dashed border-transparent p-0.5 hover:border-gray-200"
      style={blockInlineStyle(col)}
    >
      <SortableContext items={col.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        {col.children.map((el) => (
          <NestedItemWrapper
            key={el.id}
            id={el.id}
            onDelete={() => onDeleteElement(col.id, el.id)}
            isSelected={selectedBlockId === el.id}
            onSelect={() => onSelectBlock(el.id)}
          >
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
  selectedBlockId,
  onSelectBlock,
}: {
  row: RowBlock;
  renderElement: RenderElementFn;
  onDeleteElement: (containerId: string, elementId: string) => void;
  onAddElement: (ref: ContainerRef, type: PaletteType) => void;
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
}) {
  return (
    <div className="flex gap-6" style={blockInlineStyle(row)}>
      {row.columns.map((col, colIndex) => (
        <ColumnEditor
          key={col.id}
          col={col}
          rowId={row.id}
          colIndex={colIndex}
          renderElement={renderElement}
          onDeleteElement={onDeleteElement}
          onAddElement={onAddElement}
          selectedBlockId={selectedBlockId}
          onSelectBlock={onSelectBlock}
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
  selectedBlockId,
  onSelectBlock,
}: {
  section: SectionBlock;
  renderElement: RenderElementFn;
  onDeleteChild: (containerId: string, childId: string) => void;
  onAddElement: (ref: ContainerRef, type: PaletteType) => void;
  onAddRow: (sectionId: string, layout: RowBlock["layout"]) => void;
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
}) {
  const ref: ContainerRef = { kind: "section", sectionId: section.id };
  const { setNodeRef } = useDroppable({ id: containerKey(ref) });
  return (
    <div ref={setNodeRef} style={blockInlineStyle(section)}>
      <SortableContext items={section.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        {section.children.map((child) =>
          child.type === "row" ? (
            <NestedItemWrapper
              key={child.id}
              id={child.id}
              onDelete={() => onDeleteChild(section.id, child.id)}
              deleteTitle="Delete row"
              isSelected={selectedBlockId === child.id}
              onSelect={() => onSelectBlock(child.id)}
            >
              <RowEditor
                row={child}
                renderElement={renderElement}
                onDeleteElement={onDeleteChild}
                onAddElement={onAddElement}
                selectedBlockId={selectedBlockId}
                onSelectBlock={onSelectBlock}
              />
            </NestedItemWrapper>
          ) : (
            <NestedItemWrapper
              key={child.id}
              id={child.id}
              onDelete={() => onDeleteChild(section.id, child.id)}
              isSelected={selectedBlockId === child.id}
              onSelect={() => onSelectBlock(child.id)}
            >
              {renderElement(child, section.id)}
            </NestedItemWrapper>
          )
        )}
      </SortableContext>
      <AddBlockMenu onPick={(type) => onAddElement(ref, type)} onPickRow={(layout) => onAddRow(section.id, layout)} />
    </div>
  );
}

// Not a block id — must never collide with one findBlockLocation could resolve.
const PAGE_SETTINGS_ID = "__page_settings__";

export type WysiwygCanvasProps = {
  tree: PageBlockTree;
  onChange: (tree: PageBlockTree) => void;
  resizeImageFile: (file: File) => Promise<string>;
  imageBusyBlockId: string | null;
  onImageBusyChange: (blockId: string | null) => void;
  onImageError: (message: string) => void;
  productTitle: string;
  ctaClassName?: string;
  /**
   * An editor-only block pinned after the tree — for page furniture that is generated, not
   * authored, so it has no place in page_copy but still belongs on the canvas.
   *
   * The blog home's post list is the case this exists for: it's rendered from the tenant's posts,
   * not from their block tree, but it IS part of the page they're looking at, and its settings
   * should open in the same panel as everything else rather than in a separate form below the
   * sheet. Not draggable and not deletable, because its position on the real page is fixed.
   */
  /**
   * Page-level settings, reached by a ⚙ in the canvas toolbar.
   *
   * The canvas already gives every BLOCK a settings affordance; without this the PAGE itself was
   * the only thing on screen you couldn't open settings for. It matters more in the fullscreen
   * editor, where the fields that used to sit around the canvas aren't visible at all.
   */
  settings?: { title: string; panel: React.ReactNode };
  appendix?: {
    /** Selection key. Must not collide with a real block id — prefix it. */
    id: string;
    /** Title shown at the top of the settings panel. */
    title: string;
    /** What appears on the page sheet. */
    preview: React.ReactNode;
    /** The controls shown in the side panel while it's selected. */
    panel: React.ReactNode;
  };
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
  settings,
  appendix,
}: WysiwygCanvasProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  // Phase O.4: which block the style panel is showing. Not persisted, not sent to the server —
  // purely a client-side "what am I editing right now" pointer, resolved back to the live block
  // object via findBlockLocation on every render (never stored stale) so it survives edits to
  // OTHER blocks (a sibling's commit re-renders the tree, but the selected id still resolves).
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const selectedBlock: Block | null = selectedBlockId
    ? findBlockLocation(tree, selectedBlockId)?.block ?? findFormInputBlock(tree, selectedBlockId)
    : null;
  // The appendix isn't in the tree, so findBlockLocation can't resolve it — check by id instead.
  const appendixSelected = !!appendix && selectedBlockId === appendix.id;
  // Page settings aren't a block either, so they get their own sentinel rather than an id
  // findBlockLocation could ever resolve.
  const settingsSelected = !!settings && selectedBlockId === PAGE_SETTINGS_ID;

  function updateStyle(blockId: string, patch: Record<string, unknown>) {
    onChange(updateBlockStyle(tree, blockId, patch));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    // Dropped FROM the palette. The active id carries what to create, not an existing block, so
    // there is nothing to move — resolve where it landed and insert there. Same drop-target
    // resolution as the nested branch below (a block id means "before this one", a container's own
    // droppable id means "the empty space in this container").
    if (activeId.startsWith("palette-")) {
      const dropped = paletteDropTarget(overId);
      if (!dropped) return;
      const { ref, index } = dropped;
      if (activeId.startsWith("palette-el:")) {
        const type = activeId.slice("palette-el:".length) as PaletteType;
        // Input is the palette item; the form is implied — same rule as clicking it.
        onChange(
          type === "form_input"
            ? insertFormInput(tree, ref, index)
            : insertElement(tree, ref, index, type),
        );
        return;
      }
      if (activeId.startsWith("palette-row:")) {
        // Rows live only in sections. Dropping one into a column resolves to that column's own
        // section rather than refusing the drop — refusing would read as a broken drag target.
        const sectionId = sectionIdForRef(ref);
        if (!sectionId) return;
        const layout = activeId.slice("palette-row:".length) as RowBlock["layout"];
        onChange(insertRow(tree, sectionId, ref.kind === "section" ? index : Number.MAX_SAFE_INTEGER, layout));
      }
      return;
    }

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

  // Where a palette item dropped on `overId` should land. Root is never a valid home for an
  // element or a row, so dropping onto a Section resolves to "inside that section" rather than
  // "beside it at root" — otherwise the most obvious drop target on the page would do nothing.
  function paletteDropTarget(overId: string): { ref: ContainerRef; index: number } | null {
    const container = parseContainerKey(overId);
    if (container) return { ref: container, index: Number.MAX_SAFE_INTEGER };
    const loc = findBlockLocation(tree, overId);
    if (!loc) return null;
    if (loc.ref.kind === "root") {
      if (loc.block.type === "section") {
        return { ref: { kind: "section", sectionId: loc.block.id }, index: Number.MAX_SAFE_INTEGER };
      }
      const fallback = paletteTargetRef();
      return fallback ? { ref: fallback, index: Number.MAX_SAFE_INTEGER } : null;
    }
    return { ref: loc.ref, index: loc.index };
  }

  function sectionIdForRef(ref: ContainerRef): string | null {
    if (ref.kind === "section") return ref.sectionId;
    if (ref.kind === "column") {
      for (const b of tree.blocks) {
        if (b.type !== "section") continue;
        if (b.children.some((c) => c.type === "row" && c.id === ref.rowId)) return b.id;
      }
    }
    const last = [...tree.blocks].reverse().find((b) => b.type === "section");
    return last ? last.id : null;
  }

  function commit(blockId: string, patch: Record<string, unknown>) {
    onChange(updateBlockContent(tree, blockId, patch));
  }

  // Every block on the page a button could point at, flattened with a readable label. Offered as a
  // dropdown rather than a free-text id field: the ids are generated, so asking someone to type one
  // is asking them to get it wrong, and the validator hard-rejects a malformed target — meaning a
  // typo wouldn't fail at the button, it would fail the whole page save.
  function actionTargets(): { id: string; label: string; isForm: boolean }[] {
    const out: { id: string; label: string; isForm: boolean }[] = [];
    const push = (b: Block) => {
      const isForm = b.type === "form" || (b as LockedBlock).locked === "lead_capture_form";
      out.push({ id: b.id, label: blockLabel(b), isForm });
    };
    for (const b of tree.blocks) {
      push(b);
      if (b.type !== "section") continue;
      for (const c of b.children) {
        push(c);
        if (c.type !== "row") continue;
        for (const col of c.columns) for (const el of col.children) push(el);
      }
    }
    return out;
  }

  function deleteChild(containerId: string, childId: string) {
    onChange(removeChildBlock(tree, containerId, childId));
  }

  // Root-level delete, for Sections. Clears the selection when the selected block goes with it,
  // or the style panel would keep a dead id and render nothing with no explanation.
  function deleteRootBlock(blockId: string) {
    if (selectedBlockId === blockId) setSelectedBlockId(null);
    onChange({ ...tree, blocks: tree.blocks.filter((b) => b.id !== blockId) });
  }

  function addElement(ref: ContainerRef, type: PaletteType) {
    // Input is the palette item; the form is implied — insertFormInput appends to the page's
    // existing form (the locked opt-in one counts) or wraps a new one around the first field.
    if (type === "form_input") {
      onChange(insertFormInput(tree, ref, Number.MAX_SAFE_INTEGER));
      return;
    }
    onChange(insertElement(tree, ref, Number.MAX_SAFE_INTEGER, type));
  }

  function addRow(sectionId: string, layout: RowBlock["layout"]) {
    onChange(insertRow(tree, sectionId, Number.MAX_SAFE_INTEGER, layout));
  }

  // Where a palette pick lands: the container the current selection points at (a selected
  // Section/Column directly; the column or section HOLDING a selected element/row), else the
  // last Section. The inline "+ Add block" menus stay the position-specific alternative.
  function paletteTargetRef(): ContainerRef | null {
    if (selectedBlockId) {
      const loc = findBlockLocation(tree, selectedBlockId);
      if (loc) {
        if (loc.block.type === "section") return { kind: "section", sectionId: loc.block.id };
        if (loc.ref.kind !== "root") return loc.ref;
      }
    }
    const lastSection = [...tree.blocks].reverse().find((b) => b.type === "section");
    return lastSection ? { kind: "section", sectionId: lastSection.id } : null;
  }

  function paletteAddElement(type: PaletteType) {
    const ref = paletteTargetRef();
    if (ref) addElement(ref, type);
  }

  function paletteAddRow(layout: RowBlock["layout"]) {
    const ref = paletteTargetRef();
    // Rows live only in sections — a column/section-child target resolves to... the section is
    // only directly known for kind:"section"; for a column target fall back to the last section.
    if (ref?.kind === "section") {
      addRow(ref.sectionId, layout);
      return;
    }
    const lastSection = [...tree.blocks].reverse().find((b) => b.type === "section");
    if (lastSection) addRow(lastSection.id, layout);
  }

  // toPatch defaults to the plain image block's shape; the testimonial passes its own, so both
  // go through the same resize (which is what actually keeps a phone photo under the size cap).
  async function pickImage(
    blockId: string,
    file: File,
    toPatch: (dataUrl: string) => Record<string, unknown> = (dataUrl) => ({ dataUrl })
  ) {
    onImageBusyChange(blockId);
    try {
      const resized = await resizeImageFile(file);
      onChange(updateBlockContent(tree, blockId, toPatch(resized)));
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
            style={blockInlineStyle(el)}
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
            style={blockInlineStyle(el)}
          />
        );
      case "paragraph": {
        const custom = blockInlineStyle(el);
        return (
          <EditableText
            as="p"
            value={el.content.text}
            onCommit={(v) => commit(el.id, { text: v })}
            maxLength={3000}
            multiline
            style={Object.keys(custom).length > 0 ? custom : { fontSize: 18, color: "#333" }}
          />
        );
      }
      case "image":
        return (
          <div className="group/img relative">
            {el.content.dataUrl ? (
              <img
                src={el.content.dataUrl}
                alt={el.content.alt || productTitle}
                className="max-w-full rounded-xl"
                style={blockInlineStyle(el)}
              />
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
            <ul style={{ paddingLeft: 20, ...blockInlineStyle(el) }}>
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
          <div style={blockInlineStyle(el)}>
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
        return <hr className="my-4 border-t border-gray-200" style={blockInlineStyle(el)} />;
      case "image_list":
        return (
          <div style={blockInlineStyle(el)}>
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
      case "button": {
        // The action lives in the ⚙ settings panel now (BlockSettingsPanel) — it was a row of
        // selects sitting under the button on the canvas, which is chrome the published page
        // doesn't have and which made a button look twice its real height while editing. Only the
        // label is edited in place; a short summary of where it goes stays visible on hover so you
        // don't have to open the panel to answer "where does this go".
        const action: ButtonAction = el.content.action ?? { kind: "link", href: el.content.href ?? "" };
        const targets = actionTargets();
        const label = (() => {
          switch (action.kind) {
            case "scroll":
              return `Scrolls to ${targets.find((t) => t.id === action.targetId)?.label ?? "a deleted block"}`;
            case "popup":
              return `Opens ${targets.find((t) => t.id === action.formId)?.label ?? "a deleted form"}`;
            case "submit":
              return "Submits the form it's in";
            default:
              return action.href ? `Goes to ${action.href}` : "No destination set yet";
          }
        })();
        return (
          <div className="group/btn my-2">
            <EditableText
              as="span"
              value={el.content.text}
              onCommit={(v) => commit(el.id, { text: v })}
              maxLength={60}
              className="inline-block rounded-lg bg-[#16a34a] px-6 py-3 text-[15px] font-semibold text-white"
              style={blockInlineStyle(el)}
            />
            <div className="mt-1 truncate text-[11px] text-gray-400 opacity-0 transition-opacity group-hover/btn:opacity-100">
              {label}
            </div>
          </div>
        );
      }
      case "video": {
        const src = el.content.source;
        return (
          <div className="my-3" style={blockInlineStyle(el)}>
            {src ? (
              // The real player, not a placeholder — a VSL's whole page is the video, so "does it
              // actually load" is the one thing the canvas has to answer.
              <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ paddingTop: "56.25%" }}>
                {src.provider === "file" ? (
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    src={src.url}
                    className="absolute inset-0 h-full w-full"
                  />
                ) : (
                  <iframe
                    src={embedUrl(src)}
                    title={el.content.title || "Video"}
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full border-0"
                  />
                )}
              </div>
            ) : (
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-300 bg-gray-50 text-center">
                <Video className="h-6 w-6 text-gray-400" />
                <span className="text-[13px] text-gray-500">Paste a video link below</span>
                <span className="text-[11px] text-gray-400">YouTube, Vimeo, or a direct .mp4 URL</span>
              </div>
            )}
            <input
              type="url"
              defaultValue={sourceToDisplayUrl(src)}
              onBlur={(e) => {
                const parsed = parseVideoUrl(e.target.value);
                // Rejected input stays in the box so it can be corrected rather than vanishing,
                // but the block keeps its previous source until something valid replaces it.
                if (!parsed && e.target.value.trim()) {
                  onImageError("That video link isn't supported — use YouTube, Vimeo, or a direct .mp4 URL.");
                  return;
                }
                onImageError("");
                commit(el.id, { source: parsed });
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              className="mt-1.5 block w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-600"
            />
          </div>
        );
      }
      case "faq_item":
        return (
          <div className="mb-1 pr-2" style={blockInlineStyle(el)}>
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
      case "testimonial": {
        const media = el.content.media;
        return (
          <div className="my-3 rounded-lg border-l-4 border-gray-300 bg-gray-50 px-4 py-3" style={blockInlineStyle(el)}>
            {/* The three variants are one block with a media switch, not three block types: the
                quote and the attribution are the same fields either way, and splitting them would
                mean losing what you'd typed when you decided to add a photo. */}
            <div className="mb-2 flex gap-1">
              {TESTIMONIAL_MEDIA_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    commit(el.id, {
                      media:
                        k === "image"
                          ? { kind: "image", dataUrl: media.kind === "image" ? media.dataUrl : null }
                          : k === "video"
                            ? { kind: "video", source: media.kind === "video" ? media.source : null }
                            : { kind: "text" },
                    })
                  }
                  className={`rounded px-2 py-0.5 text-[11px] capitalize ${
                    media.kind === k ? "bg-gray-800 text-white" : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>

            {media.kind === "image" && (
              <div className="mb-2 flex items-center gap-2">
                {media.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={media.dataUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-gray-300 bg-white">
                    <ImageIcon className="h-5 w-5 text-gray-400" />
                  </div>
                )}
                <label className="cursor-pointer rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-600">
                  {media.dataUrl ? "Replace" : "Upload photo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) pickImage(el.id, file, (dataUrl) => ({ media: { kind: "image", dataUrl } }));
                    }}
                  />
                </label>
                {media.dataUrl && (
                  <button
                    type="button"
                    onClick={() => commit(el.id, { media: { kind: "image", dataUrl: null } })}
                    className="text-[11px] text-gray-500 underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}

            {media.kind === "video" && (
              <div className="mb-2">
                {media.source ? (
                  <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ paddingTop: "56.25%" }}>
                    {media.source.provider === "file" ? (
                      <video controls playsInline preload="metadata" src={media.source.url} className="absolute inset-0 h-full w-full" />
                    ) : (
                      <iframe
                        src={embedUrl(media.source)}
                        title="Testimonial video"
                        loading="lazy"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                        className="absolute inset-0 h-full w-full border-0"
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white text-[12px] text-gray-500">
                    Paste the video link below
                  </div>
                )}
                <input
                  type="url"
                  defaultValue={sourceToDisplayUrl(media.source)}
                  onBlur={(e) => {
                    const parsed = parseVideoUrl(e.target.value);
                    if (!parsed && e.target.value.trim()) {
                      onImageError("That video link isn't supported — use YouTube, Vimeo, or a direct .mp4 URL.");
                      return;
                    }
                    onImageError("");
                    commit(el.id, { media: { kind: "video", source: parsed } });
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="mt-1.5 block w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-600"
                />
              </div>
            )}

            <EditableText
              as="p"
              value={el.content.quote}
              onCommit={(v) => commit(el.id, { quote: v })}
              maxLength={3000}
              multiline
              placeholder="What did they say?"
              className="block text-[17px] italic leading-relaxed text-gray-700"
            />
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
              <EditableText
                as="span"
                value={el.content.name}
                onCommit={(v) => commit(el.id, { name: v })}
                maxLength={200}
                placeholder="Name"
                className="text-[14px] font-semibold text-gray-900"
              />
              <EditableText
                as="span"
                value={el.content.role}
                onCommit={(v) => commit(el.id, { role: v })}
                maxLength={200}
                placeholder="Role or location"
                className="text-[13px] text-gray-500"
              />
            </div>
          </div>
        );
      }
      case "carousel": {
        const slides = el.content.slides;
        const setSlides = (next: typeof slides) => commit(el.id, { slides: next });
        return (
          <div className="my-3" style={blockInlineStyle(el)}>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {slides.map((s, i) => (
                <div key={i} className="group/sl relative w-40 shrink-0">
                  {s.imageDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.imageDataUrl} alt="" className="h-24 w-full rounded-lg object-cover" />
                  ) : (
                    <label className="flex h-24 w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-[11px] text-gray-400 hover:border-emerald-400">
                      Add image
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file)
                            pickImage(el.id, file, (dataUrl) => ({
                              slides: slides.map((x, j) => (j === i ? { ...x, imageDataUrl: dataUrl } : x)),
                            }));
                        }}
                      />
                    </label>
                  )}
                  <EditableText
                    value={s.caption}
                    onCommit={(v) => setSlides(slides.map((x, j) => (j === i ? { ...x, caption: v } : x)))}
                    maxLength={1000}
                    placeholder="Caption"
                    className="mt-1 block text-center text-[11px] text-gray-500"
                  />
                  {slides.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSlides(slides.filter((_, j) => j !== i))}
                      className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white opacity-0 group-hover/sl:opacity-100"
                      title="Remove slide"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSlides([...slides, { imageDataUrl: null, caption: "" }])}
                className="text-[11px] text-emerald-600 hover:underline"
              >
                + Add slide
              </button>
              {/* Says what the published block actually is, because the editor shows a row of
                  thumbnails and the real page shows one slide at a time. */}
              <span className="text-[11px] text-gray-400">Visitors swipe or scroll through these.</span>
            </div>
          </div>
        );
      }
      case "countdown": {
        const cd = el.content;
        return (
          <div className="my-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-center" style={blockInlineStyle(el)}>
            <EditableText
              value={cd.label}
              onCommit={(v) => commit(el.id, { label: v })}
              maxLength={200}
              placeholder="Label above the clock"
              className="block text-[13px] text-gray-500"
            />
            <div className="my-1 text-[28px] font-bold tabular-nums text-gray-800">
              {cd.mode === "evergreen"
                ? `${String(Math.floor(cd.minutes / 60)).padStart(2, "0")}:${String(cd.minutes % 60).padStart(2, "0")}:00`
                : "--:--:--"}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
              <select
                value={cd.mode}
                onChange={(e) => commit(el.id, { mode: e.target.value })}
                className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-600"
              >
                <option value="evergreen">Per visitor</option>
                <option value="date">Fixed date</option>
              </select>
              {cd.mode === "evergreen" ? (
                <label className="flex items-center gap-1 text-gray-500">
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    value={cd.minutes}
                    onChange={(e) => commit(el.id, { minutes: Number(e.target.value) })}
                    className="w-16 rounded border border-gray-300 px-1 py-0.5"
                  />
                  minutes
                </label>
              ) : (
                <input
                  type="datetime-local"
                  value={cd.deadline ? new Date(cd.deadline).toISOString().slice(0, 16) : ""}
                  onChange={(e) =>
                    commit(el.id, { deadline: e.target.value ? new Date(e.target.value).toISOString() : null })
                  }
                  className="rounded border border-gray-300 px-1 py-0.5 text-gray-600"
                />
              )}
            </div>

            <EditableText
              value={cd.expiredText}
              onCommit={(v) => commit(el.id, { expiredText: v })}
              maxLength={200}
              placeholder="Shown when it reaches zero"
              className="mt-1.5 block text-[11px] text-gray-400"
            />
            <p className="mt-1 text-[10px] leading-snug text-gray-400">
              {cd.mode === "evergreen"
                ? "Each visitor gets their own countdown, remembered across refreshes — it won't restart."
                : "Counts to a real date. Hidden entirely until you set one."}
            </p>
          </div>
        );
      }
      case "form": {
        // The standalone, droppable form — distinct from the locked opt-in one, which has fixed
        // name/email inputs it renders itself. This one starts empty, so it needs its own field
        // presets or an inserted form is a box with a button and nothing to fill in.
        const fields = el.content ? (el as unknown as { children?: FormInputBlock[] }).children ?? [] : [];
        return (
          <div
            className="my-3 rounded-xl border border-[#e5e5e5] bg-gray-50 p-5"
            style={blockInlineStyle(el)}
          >
            <EditableText
              value={el.content.title}
              onCommit={(v) => commit(el.id, { title: v })}
              maxLength={120}
              placeholder="Form heading (optional)"
              className="mb-2 block text-[17px] font-semibold text-gray-800"
            />
            <div className="mb-3 space-y-2">
              {/* Email is what a contact row is keyed on (contacts.email is NOT NULL), so the form
                  always renders it and it isn't a removable field. */}
              <div className="rounded-lg border border-gray-300 bg-white px-3.5 py-3 text-[13px] text-gray-400">
                Email address (required)
              </div>
              {fields.map((f) => renderFormField(f, el.id))}
            </div>

            <div className="mb-3 flex flex-wrap gap-1">
              {FIELD_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() =>
                    onChange(
                      addChildBlock(tree, el.id, {
                        id: newBlockId(),
                        type: "form_input",
                        style: {},
                        content: {
                          label: preset.label,
                          fieldKey: uniqueFieldKey(preset.fieldKey, fields),
                          fieldType: preset.fieldType,
                          placeholder: preset.placeholder ?? "",
                          required: false,
                          ...(CHOICE_FIELD_TYPES.includes(preset.fieldType)
                            ? { options: ["Option 1", "Option 2"] }
                            : {}),
                        },
                      } as FormInputBlock)
                    )
                  }
                  disabled={fields.length >= 10}
                  className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-40"
                >
                  <Plus className="h-2.5 w-2.5" /> {preset.label}
                </button>
              ))}
            </div>

            <EditableText
              as="div"
              value={el.content.submitText}
              onCommit={(v) => commit(el.id, { submitText: v })}
              maxLength={60}
              className="rounded-lg bg-[#16a34a] px-6 py-3 text-center text-[15px] font-semibold text-white"
            />

            <div className="mt-2 space-y-1.5">
              <EditableText
                value={el.content.successText}
                onCommit={(v) => commit(el.id, { successText: v })}
                maxLength={200}
                placeholder="Shown after a successful submit"
                className="block text-[11px] text-gray-400"
              />
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <input
                  type="checkbox"
                  checked={el.content.popup}
                  onChange={(e) => commit(el.id, { popup: e.target.checked })}
                />
                Hidden until a button opens it
              </label>
            </div>
          </div>
        );
      }
    }
  };

  function renderFormField(field: FormInputBlock, formId: string) {
    const isChoice = CHOICE_FIELD_TYPES.includes(field.content.fieldType);
    const options = field.content.options ?? [];

    // Switching INTO a choice type with no options would render nothing on the live page (the
    // renderer skips an option-less radio/select), so two are seeded here.
    function changeType(next: string) {
      const patch: Record<string, unknown> = { fieldType: next };
      if (CHOICE_FIELD_TYPES.includes(next as any) && options.length === 0) {
        patch.options = ["Option 1", "Option 2"];
      }
      commit(field.id, patch);
    }

    function setOption(i: number, value: string) {
      const next = [...options];
      next[i] = value;
      commit(field.id, { options: next });
    }

    return (
      <div key={field.id} className="group/item relative mb-2 rounded border border-gray-200 bg-gray-50 p-2 pr-6">
        <div className="flex items-center gap-2">
          <EditableText
            value={field.content.label}
            onCommit={(v) => commit(field.id, { label: v })}
            maxLength={100}
            className="flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-600"
          />
          <select
            value={field.content.fieldType}
            onChange={(e) => changeType(e.target.value)}
            className="rounded border border-gray-300 bg-white px-1 py-1 text-xs"
          >
            {FIELD_TYPE_LABELS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <label className="flex shrink-0 items-center gap-1 text-[11px] text-gray-500">
            <input
              type="checkbox"
              checked={field.content.required}
              onChange={(e) => commit(field.id, { required: e.target.checked })}
            />
            req
          </label>
          <button
            type="button"
            title="Input settings"
            onClick={() => setSelectedBlockId(field.id)}
            className="hidden text-gray-400 hover:text-gray-700 group-hover/item:block"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChange(removeChildBlock(tree, formId, field.id))}
            className="hidden text-gray-400 hover:text-red-500 group-hover/item:block"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {isChoice && (
          <div className="mt-2 space-y-1 pl-1">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400">{field.content.fieldType === "radio" ? "○" : "—"}</span>
                <input
                  value={opt}
                  onChange={(e) => setOption(i, e.target.value)}
                  className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-[12px]"
                />
                <button
                  type="button"
                  onClick={() => commit(field.id, { options: options.filter((_, j) => j !== i) })}
                  className="text-gray-400 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => commit(field.id, { options: [...options, `Option ${options.length + 1}`] })}
              disabled={options.length >= 12}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
            >
              <Plus className="h-3 w-3" /> Add choice
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderLockedBlock(block: LockedBlock) {
    switch (block.locked) {
      case "disclosure":
        return (
          <p className="text-[11px] text-gray-400" style={blockInlineStyle(block)}>
            Affiliate disclosure — locked, always shown at the bottom of the page.
          </p>
        );
      case "lead_capture_form":
        return (
          <div
            className="mx-auto max-w-[420px] rounded-xl border border-[#e5e5e5] bg-gray-50 p-6"
            style={blockInlineStyle(block)}
          >
            <div className="mb-3 space-y-2">
              {/* These two are rendered by the form itself. Email is what a contact row is keyed
                  on (contacts.email is NOT NULL), so a form without it would accept submissions
                  and store none — the form as a whole is removable instead. */}
              <div className="rounded-lg border border-gray-300 bg-white px-3.5 py-3 text-[13px] text-gray-400">First name</div>
              <div className="rounded-lg border border-gray-300 bg-white px-3.5 py-3 text-[13px] text-gray-400">Email address (required)</div>
              {(block.children ?? []).map((f) => renderFormField(f, block.id))}
            </div>
            <div className="mb-3 flex flex-wrap gap-1">
              {FIELD_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() =>
                    onChange(
                      addChildBlock(tree, block.id, {
                        id: newBlockId(),
                        type: "form_input",
                        style: {},
                        content: {
                          label: preset.label,
                          // A readable key, not a uuid: it becomes the CSV column header and the
                          // JSON key in contacts.extra_fields, and "last_name" beats "b3f9a1…".
                          // Suffixed when it would collide with a field already on the form.
                          fieldKey: uniqueFieldKey(preset.fieldKey, block.children ?? []),
                          fieldType: preset.fieldType,
                          placeholder: preset.placeholder ?? "",
                          required: false,
                          ...(CHOICE_FIELD_TYPES.includes(preset.fieldType)
                            ? { options: ["Option 1", "Option 2"] }
                            : {}),
                        },
                      } as FormInputBlock)
                    )
                  }
                  disabled={(block.children ?? []).length >= 10}
                  className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-40"
                >
                  <Plus className="h-2.5 w-2.5" /> {preset.label}
                </button>
              ))}
            </div>
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
          // Only reachable now on a funnel step, or on an opt-in page with no form — the two
          // cases where this button IS the page's way out. An opt-in page that has a form no
          // longer carries this block at all (the form's own after-submit action replaced it),
          // so the "shown after opt-in" caption that briefly lived here would now be a lie.
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
              style={blockInlineStyle(block)}
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
              style={blockInlineStyle(block)}
            />
          </p>
        );
    }
  }

  // Elementor-style three-zone layout on lg+: collapsible block palette | canvas | settings dock.
  // Below lg the palette hides (the inline "+ Add block" menus cover insertion) and the settings
  // panel falls back to rendering under the canvas.
  return (
    // The palette lives INSIDE the DndContext: a palette item is a draggable, and dnd-kit
    // only tracks draggables mounted under the same context as the droppables they target.
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <EditorPalette onPick={paletteAddElement} onPickRow={paletteAddRow} />

      <div className="min-w-0 flex-1">
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
          {settings && (
            <>
              <span className="mx-1 h-4 w-px bg-ink-700" />
              <button
                type="button"
                onClick={() => setSelectedBlockId(settingsSelected ? null : PAGE_SETTINGS_ID)}
                title="Page settings"
                className={`rounded-md p-1.5 ${
                  settingsSelected
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "text-zinc-500 hover:bg-ink-800 hover:text-zinc-300"
                }`}
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        <div
          // bg-white/#1a1a1a are hardcoded ON PURPOSE and never themed — this is a preview of the
          // real published page, which is always light. The shadow keeps it reading as a distinct
          // "sheet" in light mode, where the app background is itself near-white.
          className="mx-auto rounded-lg border border-ink-700 bg-white px-6 py-10 text-[#1a1a1a] shadow-sm transition-[max-width] duration-200"
          style={{
            fontFamily: PAGE_FONT,
            lineHeight: 1.6,
            // Desktop reflects the page's OWN content width (capped by the column it sits in), so
            // the ⚙ width control has a visible effect here rather than only after publishing.
            // Tablet/mobile stay pinned to real device widths — that's what the toggle is for.
            maxWidth: device === "desktop" ? `min(100%, ${contentWidthOf(tree)}px)` : DEVICE_WIDTHS[device],
          }}
        >
            <SortableContext items={tree.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              {tree.blocks.map((b) => (
                <RootBlockWrapper
                  key={b.id}
                  id={b.id}
                  isSelected={selectedBlockId === b.id}
                  onSelect={() => setSelectedBlockId(b.id)}
                  // Sections are deletable (they weren't — you could add one and never remove it);
                  // the four locked compliance blocks are not, and now say so instead of silently
                  // having no control.
                  onDelete={b.type === "section" ? () => deleteRootBlock(b.id) : undefined}
                  lockedReason={b.type === "section" ? undefined : LOCKED_REASONS[(b as LockedBlock).locked]}
                >
                  {b.type === "section" ? (
                    <SectionBody
                      section={b}
                      renderElement={renderElement}
                      onDeleteChild={deleteChild}
                      onAddElement={addElement}
                      onAddRow={addRow}
                      selectedBlockId={selectedBlockId}
                      onSelectBlock={setSelectedBlockId}
                    />
                  ) : (
                    <div className="group/lock relative">
                      {/* The lead form is the ONE locked kind that can be removed. An opt-in page
                          with no form is a real page — traffic straight to the offer, or the form
                          in a later step — and the CTA stops hiding behind the submit reveal when
                          it's gone (see renderBlockTree's hasLeadForm). Disclosure and CTA stay
                          undeletable: one is a compliance requirement, the other is the page's
                          only way out. */}
                      {b.locked === "lead_capture_form" && (
                        <button
                          type="button"
                          title="Remove the opt-in form from this page"
                          onClick={(e) => {
                            e.stopPropagation();
                            onChange({ ...tree, blocks: tree.blocks.filter((x) => x.id !== b.id) });
                          }}
                          className="absolute -top-2 right-0 z-10 rounded bg-white/90 p-1 text-gray-400 opacity-0 shadow-sm transition-opacity hover:text-red-600 group-hover/lock:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {renderLockedBlock(b)}
                    </div>
                  )}
                </RootBlockWrapper>
              ))}
            </SortableContext>

          {appendix && (
            <StaticBlockWrapper
              isSelected={appendixSelected}
              onSelect={() => setSelectedBlockId(appendix.id)}
            >
              {appendix.preview}
            </StaticBlockWrapper>
          )}
        </div>
      </div>

      {(selectedBlock || appendixSelected || settingsSelected) && (
        <div className="lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:w-80 lg:shrink-0 lg:overflow-y-auto">
          {settingsSelected && settings ? (
            <EditorSidePanel title={settings.title} onClose={() => setSelectedBlockId(null)}>
              {settings.panel}
            </EditorSidePanel>
          ) : appendixSelected && appendix ? (
            <EditorSidePanel title={appendix.title} onClose={() => setSelectedBlockId(null)}>
              {appendix.panel}
            </EditorSidePanel>
          ) : (
            selectedBlock && (
              <>
                {/* Content settings first — what the block DOES is the reason you opened the panel;
                    how it looks is the follow-up. A form_input has no style keys at all, so for a
                    field this is the whole panel. */}
                {hasContentSettings(selectedBlock) && (
                  <EditorSidePanel
                    title={selectedBlock.type === "button" ? "Button" : "Input"}
                    onClose={() => setSelectedBlockId(null)}
                  >
                    <BlockSettingsPanel
                      block={selectedBlock}
                      onChange={commit}
                      targets={actionTargets()}
                      forms={actionTargets().filter((t) => t.isForm)}
                    />
                  </EditorSidePanel>
                )}
                {selectedBlock.type !== "form_input" && (
                  <BlockStylePanel
                    block={selectedBlock}
                    onChange={updateStyle}
                    onClose={() => setSelectedBlockId(null)}
                  />
                )}
              </>
            )
          )}
        </div>
      )}
    </div>
    </DndContext>
  );
}
