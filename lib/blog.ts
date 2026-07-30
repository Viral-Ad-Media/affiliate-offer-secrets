import { marked } from "marked";
import { escapeHtml } from "@/lib/engine/renderPages";

export const MAX_POST_TITLE = 200;
export const MAX_POST_CONTENT = 200_000;
export const MAX_CATEGORY_NAME = 60;

// Renders tenant-authored markdown for the PUBLIC post page (app/b/[postId]/route.ts). This is a
// security boundary in the same class as the tracking snippets: post content is arbitrary
// tenant-edited text served raw to anonymous visitors on the app's shared origin (where the
// app's own session cookies live), so raw inline HTML must never pass through. marked passes
// embedded HTML straight through by design — escaping & and < in the source BEFORE parsing
// disables every HTML construct while leaving actual markdown syntax (headings, lists, links,
// emphasis, `>` blockquotes at line start) untouched. Never swap this for a "sanitize later"
// approach without a real sanitizer in place.
export function renderPostContentHtml(contentMd: string): string {
  const noHtml = contentMd.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return marked.parse(noHtml, { async: false }) as string;
}

// Full public post page. Deliberately indexable (blogs are content marketing — no X-Robots-Tag
// noindex, unlike funnel pages) with the same minimal inline-styled shell approach as rendered
// funnel pages: self-contained HTML, no app chrome, no scripts.
export function renderPublicPostHtml(post: {
  title: string;
  content_md: string;
  published_at: string | null;
  category_name?: string | null;
}): string {
  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const meta = [post.category_name, date].filter(Boolean).map((v) => escapeHtml(String(v))).join(" · ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(post.title)}</title>
<style>
  body { margin: 0; background: #fff; color: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.7; }
  main { max-width: 720px; margin: 0 auto; padding: 48px 20px 80px; }
  h1.post-title { font-size: 2.1rem; line-height: 1.2; margin: 0 0 8px; }
  .post-meta { color: #6b7280; font-size: 0.9rem; margin-bottom: 32px; }
  article h1, article h2, article h3 { line-height: 1.3; margin-top: 2em; }
  article img { max-width: 100%; height: auto; }
  article a { color: #047857; }
  article blockquote { border-left: 3px solid #d1d5db; margin-left: 0; padding-left: 16px; color: #4b5563; }
  article pre { overflow-x: auto; background: #f3f4f6; padding: 12px; border-radius: 8px; }
</style>
</head>
<body>
<main>
  <h1 class="post-title">${escapeHtml(post.title)}</h1>
  ${meta ? `<div class="post-meta">${meta}</div>` : ""}
  <article>${renderPostContentHtml(post.content_md)}</article>
</main>
</body>
</html>`;
}
