"use client";

import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Preview button for the editors: opens the CURRENT draft — unsaved edits included — as a real
// page in a new browser tab, so it looks and scrolls exactly like the live site instead of a panel
// inside the app.
//
// Nothing is saved or published to do this. The tab is a blob: document built client-side from the
// same pure renderers the save routes use, so the preview can never drift from what publishing
// produces.
//
// The rendered page is nested in a sandbox="" iframe filling that tab rather than being the tab's
// own document. That's the load-bearing detail: these pages carry a real lead-capture form (which
// POSTs to this app's own same-origin /api/public/leads) and a tenant's tracking snippets. Opened
// unsandboxed, a "preview" would fire live pixels and write a real contact row. Sandboxed, it's a
// look, not a live page.
function buildPreviewDocument(html: string, title: string): string {
  const srcdoc = html
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style>
</head>
<body><iframe sandbox="" srcdoc="${srcdoc}"></iframe></body>
</html>`;
}

export default function EditorPreviewButton({
  render,
  title,
  label = "Preview",
  className = cn(buttonVariants({ variant: "outline" }), "flex items-center gap-1.5"),
}: {
  render: () => string;
  title: string;
  label?: string;
  className?: string;
}) {
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  // This is a real <a target="_blank">, not a window.open() call, and the href is written
  // synchronously on pointerdown/focus — i.e. before the click's default action runs. A genuine
  // link activation opens a tab everywhere; window.open() gets caught by pop-up blockers and by
  // embedded browsers even when the user clicked.
  function prepare() {
    const a = anchorRef.current;
    if (!a) return;
    try {
      const url = URL.createObjectURL(
        new Blob([buildPreviewDocument(render(), title)], { type: "text/html" })
      );
      // Revoke the previous draft's document; the tab it opened already loaded its copy.
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      a.href = url;
      setError(null);
    } catch (err: any) {
      // A render failure usually means the current tree is in a state the renderer rejects —
      // exactly what a preview should surface.
      a.removeAttribute("href");
      setError(err?.message ?? String(err));
    }
  }

  return (
    <>
      <a
        ref={anchorRef}
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={prepare}
        onFocus={prepare}
        onKeyDown={prepare}
        className={`${className} cursor-pointer`}
        title="Preview the current draft in a new tab"
      >
        <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {label}
      </a>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </>
  );
}
