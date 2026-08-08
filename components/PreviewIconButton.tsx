"use client";

import { Eye } from "lucide-react";
import EditorPreviewButton from "@/components/EditorPreview";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The funnel map's eye icon. Opens the page's stored HTML in a new tab, the same way every other
 * Preview in the app does — it used to open a modal with an iframe in it, which meant the one
 * place you'd most want to see a page at real size showed it in a box two-thirds the height of the
 * screen.
 *
 * Wraps EditorPreviewButton rather than calling window.open, because that component's real
 * <a target="_blank"> (href prepared on pointerdown) is what survives pop-up blockers and embedded
 * browsers — see the reasoning in EditorPreview.tsx.
 *
 * This shows what's SAVED, not the live editor draft: a step that's never been saved has no html,
 * and gets a placeholder rather than a blank tab.
 */
const EMPTY = `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;padding:2rem;color:#444">
<p>Nothing to preview yet — open this page in the editor and save it once.</p></body>`;

export default function PreviewIconButton({
  html,
  title,
  href,
}: {
  html: string | null;
  title: string;
  /**
   * A real preview URL (`/preview/{kind}/{id}`) when the thing has one. Preferred over the blob:
   * render because it's a link — bookmarkable, shareable with a teammate, and it exists from the
   * moment the page is generated rather than from the moment it's published.
   *
   * It shows the SAME saved HTML this component would have rendered locally, served inside the
   * same empty sandbox, so nothing about what you see (or what it can't fire) changes. `html` is
   * still required as the fallback for anything with no id to address yet.
   */
  href?: string | null;
}) {
  if (href && html) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title="Preview"
        aria-label={`Preview ${title}`}
        className={cn(buttonVariants({ variant: "outline" }), "!px-2 !py-1")}
      >
        <Eye className="h-3.5 w-3.5" />
      </a>
    );
  }

  return (
    <EditorPreviewButton
      render={() => html || EMPTY}
      title={title}
      label=""
      className={cn(buttonVariants({ variant: "outline" }), "!px-2 !py-1")}
    />
  );
}
