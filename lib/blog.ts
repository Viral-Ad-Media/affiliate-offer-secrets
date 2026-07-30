import { marked } from "marked";
import {
  escapeHtml,
  renderBlockTree,
  DISCLOSURE,
  type PageBlockTree,
  type RenderCtx,
  type SectionBlock,
  type ElementBlock,
} from "@/lib/engine/renderPages";

export const MAX_POST_TITLE = 200;
export const MAX_POST_CONTENT = 200_000;
export const MAX_CATEGORY_NAME = 60;
export const MAX_BLOG_SETTING = 120;

// ---------------------------------------------------------------------------------------------
// Block-tree path (current): posts are edited with the same WysiwygCanvas the funnel editor uses,
// stored as page_copy (validated via validatePageBlockTree with pageKind "blog") and rendered to
// blog_posts.html at save time. The markdown path below it is the permanent legacy adapter for
// pre-block-tree posts and the import source (campaigns.blog_md is markdown).
// ---------------------------------------------------------------------------------------------

export function blogRenderCtx(): RenderCtx {
  return {
    pageKind: "blog",
    disclosureText: DISCLOSURE,
    // Never rendered on blog pages (the "blog" validator profile forbids the lead-capture/CTA/
    // decline locked blocks) — present only to satisfy the shared ctx shape.
    leadConsentText: "",
    campaignId: "",
    primaryHref: "",
    productTitle: "",
  };
}

// Deterministic ids (same discipline as normalizePageCopy) so converting the same markdown twice
// yields the same tree.
function makeIds() {
  let n = 0;
  return () => `blog-${++n}`;
}

// Sections cap their child count in the validator — split long articles across sections well
// under that limit.
const MAX_CHILDREN_PER_SECTION = 40;

// Converts markdown (a campaign's generated blog_md, or a legacy post's content_md) into a
// pageKind-"blog" block tree: headings/subheadings, paragraphs, bullet lists, dividers, plus the
// locked disclosure block at root. Inline links/bold survive as markdown syntax inside
// paragraph/bullet text — renderInline (lib/engine/blockTree.ts) turns them into real
// <a rel="sponsored">/<strong> tags at render time, which is how imported hoplinks keep working.
// `dropFirstH1` skips a leading "# Title" (the post's own title field renders it in the shell).
export function markdownToBlockTree(md: string, opts?: { dropFirstH1?: boolean }): PageBlockTree {
  const id = makeIds();
  const elements: ElementBlock[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");

  let paragraph: string[] = [];
  let bullets: string[] = [];
  let droppedH1 = !opts?.dropFirstH1;

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) elements.push({ id: id(), type: "paragraph", style: {}, content: { text } });
  };
  const flushBullets = () => {
    if (bullets.length > 0) {
      elements.push({ id: id(), type: "bullet_list", style: {}, content: { items: bullets.slice(0, 10) } });
    }
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushBullets();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      flushParagraph();
      flushBullets();
      const text = h[2].replace(/\*\*/g, "").trim();
      if (!droppedH1 && h[1].length === 1) {
        droppedH1 = true; // the post title renders this in the page shell
        continue;
      }
      elements.push(
        h[1].length === 1
          ? { id: id(), type: "heading", style: {}, content: { text } }
          : { id: id(), type: "subheading", style: {}, content: { text } }
      );
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      bullets.push(bullet[1].trim());
      continue;
    }
    if (/^(---+|\*\*\*+)$/.test(trimmed)) {
      flushParagraph();
      flushBullets();
      elements.push({ id: id(), type: "divider", style: {}, content: {} });
      continue;
    }
    flushBullets();
    // Blockquotes flatten to plain paragraphs (no blockquote block type exists).
    paragraph.push(trimmed.replace(/^>\s?/, ""));
  }
  flushParagraph();
  flushBullets();

  if (elements.length === 0) {
    elements.push({ id: id(), type: "paragraph", style: {}, content: { text: "Start writing your post…" } });
  }

  const sections: SectionBlock[] = [];
  for (let i = 0; i < elements.length; i += MAX_CHILDREN_PER_SECTION) {
    sections.push({
      id: id(),
      type: "section",
      style: {},
      children: elements.slice(i, i + MAX_CHILDREN_PER_SECTION),
    });
  }

  return {
    version: 2,
    blocks: [...sections, { id: id(), type: "disclosure", locked: "disclosure", style: {}, content: {} }],
  };
}

export function emptyPostTree(): PageBlockTree {
  return markdownToBlockTree("");
}

// ---------------------------------------------------------------------------------------------
// Legacy markdown rendering — the security boundary notes here still apply verbatim: content is
// arbitrary tenant text served to anonymous visitors on the app's shared origin, and marked
// passes embedded HTML straight through, so & and < are escaped BEFORE parsing. Never swap this
// for a "sanitize later" approach without a real sanitizer.
// ---------------------------------------------------------------------------------------------
export function renderPostContentHtml(contentMd: string): string {
  const noHtml = contentMd.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return marked.parse(noHtml, { async: false }) as string;
}

export type BlogSettings = { blog_title?: string | null; author_name?: string | null };

// Meta-description excerpt: first ~155 chars of readable text, markdown/HTML syntax stripped.
function postExcerpt(post: { content_md: string; html?: string | null }): string {
  const source = post.content_md?.trim()
    ? post.content_md
        .replace(/^#{1,6}\s+.*$/gm, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_>`#-]/g, "")
    : (post.html ?? "").replace(/<[^>]*>/g, " ");
  const text = source.replace(/\s+/g, " ").trim();
  return text.length > 155 ? `${text.slice(0, 152)}…` : text;
}

// Full public post page. Body comes from the block tree's write-time render (post.html) when the
// post has one, else the legacy markdown path. Deliberately indexable (no noindex — blog posts
// are content marketing), self-contained, no scripts. The .section/.row/.block-btn/etc styles
// mirror the funnel pages' stylesheet for the block-tree markup.
export function renderPublicPostHtml(post: {
  id?: string;
  title: string;
  content_md: string;
  html?: string | null;
  published_at: string | null;
  category_name?: string | null;
  settings?: BlogSettings | null;
}): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://clickbank-studio.vercel.app";
  const canonical = post.id ? `${appUrl}/b/${post.id}` : null;
  const description = postExcerpt(post);
  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const byline = post.settings?.author_name ? `By ${post.settings.author_name}` : "";
  const meta = [byline, post.category_name, date]
    .filter(Boolean)
    .map((v) => escapeHtml(String(v)))
    .join(" · ");
  const titleTag = post.settings?.blog_title ? `${post.title} — ${post.settings.blog_title}` : post.title;
  const body = post.html ?? renderPostContentHtml(post.content_md);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titleTag)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ""}
${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ""}
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(post.title)}">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ""}
${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : ""}
${post.settings?.blog_title ? `<meta property="og:site_name" content="${escapeHtml(post.settings.blog_title)}">` : ""}
${post.published_at ? `<meta property="article:published_time" content="${escapeHtml(post.published_at)}">` : ""}
<meta name="twitter:card" content="summary">
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
  /* Block-tree markup (mirrors the funnel pages' stylesheet) */
  .block-img { max-width:100%; border-radius:12px; margin:24px 0; display:block; }
  .faq-item { margin-bottom: 16px; }
  .faq-item h3 { font-size:16px; margin-bottom:4px; }
  .row { display:flex; gap:24px; flex-wrap:wrap; }
  .row .col { flex:1; min-width:200px; }
  .icon-list-item, .image-list-item { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
  .icon-list-item svg { flex-shrink:0; }
  .image-list-item img { width:48px; height:48px; object-fit:cover; border-radius:8px; flex-shrink:0; }
  .block-btn { display:inline-block; background:#16a34a; color:#fff; padding:12px 24px; border-radius:8px; font-weight:600; text-decoration:none; }
  .disclosure { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; }
</style>
</head>
<body>
<main>
  <h1 class="post-title">${escapeHtml(post.title)}</h1>
  ${meta ? `<div class="post-meta">${meta}</div>` : ""}
  <article>${body}</article>
</main>
</body>
</html>`;
}

export { renderBlockTree };
