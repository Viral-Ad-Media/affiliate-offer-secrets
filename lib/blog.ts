import { marked } from "marked";
import { themeToCssVars } from "@/lib/engine/pageTheme";
import {
  escapeHtml,
  renderBlockTree,
  contentWidthOf,
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

export type BlogSettings = {
  blog_title?: string | null;
  author_name?: string | null;
  slug?: string | null;
  description?: string | null;
  author_bio?: string | null;
  author_avatar_url?: string | null;
  permalink_style?: PermalinkStyle | null;
  // Editable intro band on the blog home (0045). intro_html is the write-time render of
  // intro_copy — the index never renders the tree directly, same as posts.
  intro_copy?: unknown;
  intro_html?: string | null;
  // How the home page lists posts (0065). Columns x rows is also the page size — see
  // postsPerPage() below.
  index_layout?: BlogIndexLayout | null;
  index_columns?: number | null;
  index_rows?: number | null;
  // Table of contents on post pages (0069). Off by default: a two-heading post gets a contents
  // box longer than the gap it summarises, which is worse than no box.
  toc_enabled?: boolean | null;
  toc_title?: string | null;
  toc_min_headings?: number | null;
};

export const MIN_TOC_HEADINGS = 2;
export const MAX_TOC_HEADINGS = 10;

export type BlogIndexLayout = "grid" | "list";

export const MIN_INDEX_COLUMNS = 1;
export const MAX_INDEX_COLUMNS = 4;
export const MIN_INDEX_ROWS = 1;
export const MAX_INDEX_ROWS = 12;

export function isBlogIndexLayout(v: unknown): v is BlogIndexLayout {
  return v === "grid" || v === "list";
}

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? Math.round(v) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** The layout, with every stored value clamped — callers never see an out-of-range number. */
export function indexLayout(settings: BlogSettings): {
  layout: BlogIndexLayout;
  columns: number;
  rows: number;
} {
  const layout = isBlogIndexLayout(settings.index_layout) ? settings.index_layout : "grid";
  return {
    layout,
    // A list is one post per row by definition, so the stored column count is ignored rather than
    // silently applied — otherwise switching to list and back would look like it lost the setting.
    columns: layout === "list" ? 1 : clampInt(settings.index_columns, MIN_INDEX_COLUMNS, MAX_INDEX_COLUMNS, 3),
    rows: clampInt(settings.index_rows, MIN_INDEX_ROWS, MAX_INDEX_ROWS, 4),
  };
}

/**
 * Posts per page = the shape you chose. A 3x4 grid shows 12; a list of 8 shows 8.
 *
 * Deriving it rather than storing it separately is what stops the pager and the visible layout
 * from disagreeing — a standalone "posts per page" field would eventually be set to a number that
 * doesn't fill the last row.
 */
export function postsPerPage(settings: BlogSettings): number {
  const { columns, rows } = indexLayout(settings);
  return columns * rows;
}

// URL structure for the path AFTER the blog root — the same on the app domain (under
// /b/{blogSlug}) and on a connected domain (where the blog IS the root).
export type PermalinkStyle = "post" | "date-post" | "category-post";

export const PERMALINK_STYLES: { value: PermalinkStyle; label: string; example: string }[] = [
  { value: "post", label: "Post name", example: "/my-first-post" },
  { value: "date-post", label: "Date and name", example: "/2026/07/my-first-post" },
  { value: "category-post", label: "Category and name", example: "/health/my-first-post" },
];

export function isPermalinkStyle(v: unknown): v is PermalinkStyle {
  return v === "post" || v === "date-post" || v === "category-post";
}

// A post's path relative to its blog root, WITHOUT a leading slash — e.g. "2026/07/my-post".
// Falls back to just the slug whenever the prefix can't be built (an unscheduled post has no
// date; an uncategorized one has no category), so a post always has a working URL rather than a
// path with an empty segment in it.
export function postPathSuffix(
  style: PermalinkStyle | null | undefined,
  post: { slug?: string | null; id?: string | null; published_at?: string | null; category_slug?: string | null }
): string {
  const leaf = post.slug || post.id || "";
  switch (style) {
    case "date-post": {
      if (!post.published_at) return leaf;
      const d = new Date(post.published_at);
      if (Number.isNaN(d.getTime())) return leaf;
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      return `${d.getUTCFullYear()}/${mm}/${leaf}`;
    }
    case "category-post":
      return post.category_slug ? `${post.category_slug}/${leaf}` : leaf;
    default:
      return leaf;
  }
}

export const MAX_BLOG_BIO = 600;
// Category descriptions are a line or two under the filter chips, not an article.
export const MAX_CATEGORY_DESCRIPTION = 300;
export const MAX_POST_EXCERPT = 300;
// Featured images are full-width hero art, so they get a larger cap than the inline
// MAX_AD_IMAGE/page-block images; still a data URL, same validated-format convention.
export const MAX_FEATURED_IMAGE_CHARS = 2_000_000; // ~1.5MB decoded — a 16:9 JPEG hero fits well under this; PNG never did

// URL-safe slug from arbitrary title text. Deliberately ASCII-only and lossy — a slug is an
// identifier, not content; anything unmappable collapses to a dash. Empty input (a title of only
// punctuation/non-Latin) returns "" and the caller falls back to the row id.
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

// Canonical public URL for a post on the app's own domain. Prefers the pretty slug pair and falls
// back to the legacy /b/{uuid} form when the blog or the post hasn't been given a slug yet, so a
// post is always reachable at *some* stable URL. `post` carries the extra fields the date/category
// permalink styles need; omitting it keeps the plain post-name structure.
export function blogPostPath(
  blogSlug: string | null | undefined,
  postSlug: string | null | undefined,
  postId: string,
  post?: { published_at?: string | null; category_slug?: string | null },
  style?: PermalinkStyle | null
): string {
  if (!blogSlug || !postSlug) return `/b/${postId}`;
  return `/b/${blogSlug}/${postPathSuffix(style, { ...post, slug: postSlug, id: postId })}`;
}

// Same, for a blog served at a connected domain's root.
export function blogPostPathOnDomain(
  post: { slug?: string | null; id?: string | null; published_at?: string | null; category_slug?: string | null },
  style?: PermalinkStyle | null
): string {
  return `/${postPathSuffix(style, post)}`;
}

export function blogIndexPath(blogSlug: string | null | undefined): string | null {
  return blogSlug ? `/b/${blogSlug}` : null;
}

// Shared by the post page and the index so the two can never drift visually.
const PUBLIC_CSS = `
  :root { --ink:#1a1a1a; --muted:#6b7280; --line:#e5e7eb; --accent:#047857; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--t-bg, #fff); color: var(--t-text, var(--ink)); font-family: var(--t-body-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif); line-height: var(--t-line-height, 1.7); font-size: var(--t-base-size, 16px); }
  a { color: var(--t-primary, var(--accent)); }
  /* Post content column. width:90% gives narrow screens a gutter with no media query; the px
     cap keeps a line of text readable on a wide monitor. --content-w comes from the post's own
     page_copy.contentWidth; the index grid below keeps its own fixed 1040px on purpose. */
  main { width: 90%; max-width: var(--content-w, 1280px); margin: 0 auto; padding: 48px 20px 80px; }
  .site-head { border-bottom: 1px solid var(--line); }
  .site-head-inner { max-width: 1040px; margin: 0 auto; padding: 20px; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .site-title { font-size: 1.15rem; font-weight: 700; text-decoration: none; color: var(--ink); }
  .site-desc { color: var(--muted); font-size: .9rem; margin: 0; }
  .cat-desc { color: var(--muted); font-size: .95rem; margin: 0 0 24px; max-width: 640px; }
  .home-intro { max-width: 720px; margin: 0 0 32px; }
  .home-intro > :first-child { margin-top: 0; }
  h1.post-title { font-size: 2.1rem; line-height: 1.2; margin: 0 0 8px; }
  .post-meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 32px; }
  .featured { width: 100%; height: auto; border-radius: 14px; margin: 0 0 32px; display: block; }
  article h1, article h2, article h3 { line-height: 1.3; margin-top: 2em; }
  article img { max-width: 100%; height: auto; }
  /* Contents box. scroll-margin-top on the headings keeps an anchored jump from parking the
     heading flush against the viewport edge. */
  .toc { border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; margin: 28px 0; background: #fbfbfb; }
  .toc-title { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 0 0 8px; }
  .toc ul { list-style: none; margin: 0; padding: 0; }
  .toc li { margin: 4px 0; font-size: .95rem; }
  .toc li.toc-l3 { padding-left: 18px; font-size: .9rem; }
  .toc a { color: var(--ink); text-decoration: none; }
  .toc a:hover { color: var(--accent); text-decoration: underline; }
  article h2, article h3 { scroll-margin-top: 16px; }
  article blockquote { border-left: 3px solid #d1d5db; margin-left: 0; padding-left: 16px; color: #4b5563; }
  article pre { overflow-x: auto; background: #f3f4f6; padding: 12px; border-radius: 8px; }
  .author-box { display: flex; gap: 16px; align-items: flex-start; margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line); }
  .author-box img { width: 56px; height: 56px; border-radius: 999px; object-fit: cover; flex-shrink: 0; }
  .author-box .name { font-weight: 600; }
  .author-box .bio { color: var(--muted); font-size: .92rem; margin: 4px 0 0; }
  /* Index */
  .index-wrap { max-width: 1040px; margin: 0 auto; padding: 40px 20px 80px; }
  .cat-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 32px; }
  .cat-bar a { display: inline-block; padding: 5px 12px; border: 1px solid var(--line); border-radius: 999px; font-size: .85rem; text-decoration: none; color: var(--muted); }
  .cat-bar a:hover { border-color: var(--accent); color: var(--accent); }
  .cat-bar a[aria-current="page"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  .pager { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 48px; }
  .pager a { padding: 8px 16px; border: 1px solid var(--line); border-radius: 8px; text-decoration: none; font-size: .9rem; }
  .pager a:hover { border-color: var(--accent); }
  .pager .page-of { color: var(--muted); font-size: .85rem; }
  .post-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 32px; list-style: none; padding: 0; margin: 0; }
  /* Chosen column counts. minmax(0,1fr) rather than a min width, so N columns really means N —
     an auto-fill min width would silently reflow 4 into 3 on a laptop. The media query below is
     what handles narrow screens, once, in a predictable place. */
  .post-grid.cols-1 { grid-template-columns: minmax(0, 1fr); }
  .post-grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .post-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .post-grid.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; }
  /* List: one per row, thumbnail beside the text instead of above it. */
  .post-grid.as-list { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .post-grid.as-list .post-card { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 20px; align-items: start; border-bottom: 1px solid var(--line); padding-bottom: 24px; }
  .post-grid.as-list .post-card:last-child { border-bottom: none; }
  .post-grid.as-list .post-card h2 { margin-top: 0; }
  @media (max-width: 900px) {
    .post-grid.cols-3, .post-grid.cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 620px) {
    .post-grid.cols-2, .post-grid.cols-3, .post-grid.cols-4 { grid-template-columns: minmax(0, 1fr); }
    .post-grid.as-list .post-card { grid-template-columns: minmax(0, 1fr); }
  }
  .post-card a.thumb { display: block; }
  .post-card img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 12px; display: block; }
  .post-card .ph { width: 100%; aspect-ratio: 16/9; border-radius: 12px; background: linear-gradient(135deg,#ecfdf5,#e0f2fe); }
  .post-card h2 { font-size: 1.15rem; line-height: 1.35; margin: 14px 0 6px; }
  .post-card h2 a { color: var(--ink); text-decoration: none; }
  .post-card h2 a:hover { color: var(--accent); }
  .post-card p { color: var(--muted); font-size: .93rem; margin: 0; }
  .card-meta { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; margin-top: 10px; }
  .empty { color: var(--muted); padding: 60px 0; text-align: center; }
  /* Block-tree markup (mirrors the funnel pages' stylesheet) */
  .block-img { max-width:100%; border-radius:12px; margin:24px 0; display:block; }
  /* 16:9 responsive frame — the wrapper owns the ratio so an iframe (which has no intrinsic
     size) and a <video> (which does) lay out identically. */
  .video-wrap { position:relative; width:100%; margin:24px 0; padding-top:56.25%; border-radius:12px; overflow:hidden; background:#000; }
  .video-wrap iframe, .video-wrap video { position:absolute; inset:0; width:100%; height:100%; border:0; display:block; }
  .testimonial { margin:24px 0; padding:20px 24px; border-left:4px solid #e0e0e0; background:#fafafa; border-radius:8px; }
  .testimonial blockquote { margin:0; font-size:17px; line-height:1.6; font-style:italic; color:#333; }
  .testimonial figcaption { margin-top:10px; font-size:14px; color:#666; }
  .testimonial .tm-name { font-weight:600; color:#1a1a1a; }
  .testimonial .tm-role { display:block; font-size:13px; color:#888; }
  .testimonial .tm-avatar { width:64px; height:64px; margin:0 0 12px; border-radius:50%; overflow:hidden; }
  .testimonial .tm-avatar img { width:100%; height:100%; object-fit:cover; display:block; }
  .testimonial .tm-media.video-wrap { margin:0 0 14px; }
  .carousel { display:flex; gap:12px; overflow-x:auto; scroll-snap-type:x mandatory; scroll-behavior:smooth; margin:24px 0; padding-bottom:8px; -webkit-overflow-scrolling:touch; }
  .carousel .slide { flex:0 0 88%; scroll-snap-align:center; margin:0; }
  .carousel .slide img { width:100%; height:auto; display:block; border-radius:12px; }
  .carousel .slide figcaption { margin-top:8px; font-size:14px; color:#666; text-align:center; }
  .carousel:focus-visible { outline:2px solid #16a34a; outline-offset:4px; }
  @media (min-width:700px) { .carousel .slide { flex-basis:60%; } }
  /* Responsive visibility — set per block in the editor's own settings panel. Breakpoints match
     the editor's device toggle: mobile below 640, tablet 640-1023, desktop 1024 and up.
     !important so a future inline display value from a style key cannot silently defeat it.
     THIS BLOCK IS DUPLICATED in lib/blog.ts's PUBLIC_CSS — change both or a block hidden on a
     funnel page starts showing on a blog post. */
  @media (max-width:639px) { .hide-mobile { display:none !important; } }
  @media (min-width:640px) and (max-width:1023px) { .hide-tablet { display:none !important; } }
  @media (min-width:1024px) { .hide-desktop { display:none !important; } }
  .countdown { margin:24px 0; text-align:center; }
  .countdown .cd-label { font-size:14px; color:#666; margin-bottom:4px; }
  .countdown .cd-clock { font-size:34px; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:1px; }
  .countdown .cd-expired { font-size:16px; font-weight:600; }
  .aos-consent { position:fixed; left:0; right:0; bottom:0; z-index:2147483000; display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:12px 20px; padding:14px 20px; background:#1a1a1a; color:#f5f5f5; font-size:14px; line-height:1.5; box-shadow:0 -2px 12px rgba(0,0,0,.2); }
  .aos-consent p { margin:0; max-width:60ch; }
  .aos-consent a { color:#9ae6b4; }
  .aos-consent-actions { display:flex; gap:8px; flex-shrink:0; }
  .aos-consent button { cursor:pointer; border:1px solid #555; background:transparent; color:#f5f5f5; padding:8px 16px; border-radius:6px; font-size:14px; font-family:inherit; }
  /* Accept is emphasised but Decline is a real, equally-reachable button — a greyed-out or
     hidden reject is the dark pattern regulators single out. */
  .aos-consent .aos-consent-yes { background:var(--t-primary,#16a34a); border-color:var(--t-primary,#16a34a); font-weight:600; }
  .aos-form-wrap { margin:24px 0; }
  .aos-form { background:var(--t-surface,#fff); border:1px solid var(--t-border,#e5e5e5); border-radius:12px; padding:20px; max-width:460px; margin:0 auto; }
  .aos-form h3 { margin:0 0 10px; font-size:18px; }
  .aos-form input, .aos-form textarea, .aos-form select { width:100%; box-sizing:border-box; padding:var(--t-field-pad,12px); margin:var(--f-gap,6px) 0; border:var(--f-bw,1px) solid var(--f-bc,var(--t-field-border,#ccc)); border-radius:var(--f-br,var(--t-field-radius,8px)); background:var(--f-bg,var(--t-field-bg,#fff)); color:var(--f-fg,inherit); font-size:16px; font-family:inherit; }
  .aos-form .fld-half, .optin .fld-half { width:calc(50% - 5px); display:inline-block; vertical-align:top; }
  .aos-form .fld-half + .fld-half, .optin .fld-half + .fld-half { margin-left:8px; }
  .aos-form .consent-note { font-size:11px; color:var(--t-muted,#888); margin:8px 0; }
  .aos-form-done { font-weight:600; text-align:center; }
  /* A popup form is hidden until a button's popup action shows it. */
  .aos-form-popup { position:fixed; inset:0; z-index:2147482000; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.5); padding:20px; }
  .aos-form-popup.is-open { display:flex; }
  .aos-form-popup .aos-form { position:relative; width:100%; }
  .aos-form-close { position:absolute; top:8px; right:10px; border:0; background:none; font-size:24px; line-height:1; cursor:pointer; color:var(--t-muted,#888); }
  .faq-item { margin-bottom: 16px; }
  .faq-item h3 { font-size:16px; margin-bottom:4px; }
  .row { display:flex; gap:24px; flex-wrap:wrap; }
  .row .col { flex:1; min-width:200px; }
  .icon-list-item, .image-list-item { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
  .icon-list-item svg { flex-shrink:0; }
  .image-list-item img { width:48px; height:48px; object-fit:cover; border-radius:8px; flex-shrink:0; }
  .block-btn { display:inline-block; background:#16a34a; color:#fff; padding:12px 24px; border-radius:8px; font-weight:600; text-decoration:none; }
  .disclosure { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line); font-size: 12px; color: #888; }
`;

// Header shown on both index and post pages when the blog has been named. `base` is "" on a
// custom domain (links are root-relative there) and "/b/{slug}" on the app path.
function siteHeader(settings: BlogSettings | null | undefined, base: string): string {
  if (!settings?.blog_title) return "";
  return `<header class="site-head"><div class="site-head-inner">
  <a class="site-title" href="${escapeHtml(base || "/")}">${escapeHtml(settings.blog_title)}</a>
  ${settings.description ? `<p class="site-desc">${escapeHtml(settings.description)}</p>` : ""}
</div></header>`;
}

function authorBox(settings: BlogSettings | null | undefined): string {
  if (!settings?.author_name && !settings?.author_bio) return "";
  const avatar = settings?.author_avatar_url
    ? `<img src="${escapeHtml(settings.author_avatar_url)}" alt="" />`
    : "";
  return `<div class="author-box">${avatar}<div>
  ${settings?.author_name ? `<div class="name">${escapeHtml(settings.author_name)}</div>` : ""}
  ${settings?.author_bio ? `<p class="bio">${escapeHtml(settings.author_bio)}</p>` : ""}
</div></div>`;
}

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

// ---------------------------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------------------------

/**
 * Builds a contents list from a post's own H2/H3 headings, and gives each one an anchor.
 *
 * Works on the RENDERED HTML rather than the block tree because that's what a post page actually
 * has: `post.html` is baked at save time for published posts, and only falls back to rendering the
 * markdown. Deriving from the tree would mean the TOC and the body could disagree for any post
 * whose stored HTML predates a renderer change.
 *
 * The regex is deliberately narrow and only ever matches headings this codebase's own renderers
 * emit. Extracted text is stripped of tags and escaped before it goes into the link, so a heading
 * containing markup can't reach the page as markup a second time.
 *
 * Returns the body unchanged and an empty toc when there aren't enough headings to be worth one —
 * the caller renders nothing rather than an empty box.
 */
export function buildTableOfContents(
  bodyHtml: string,
  settings: BlogSettings | null | undefined
): { body: string; toc: string } {
  const none = { body: bodyHtml, toc: "" };
  if (!settings?.toc_enabled) return none;

  const min = Math.min(
    MAX_TOC_HEADINGS,
    Math.max(MIN_TOC_HEADINGS, settings.toc_min_headings ?? 3)
  );

  const found: { id: string; text: string; level: 2 | 3 }[] = [];
  const used = new Set<string>();

  const body = bodyHtml.replace(
    /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match, lvl: string, attrs: string, inner: string) => {
      const text = inner.replace(/<[^>]*>/g, "").trim();
      if (!text) return match;

      // Reuse an id the heading already carries; otherwise derive one and de-duplicate, since two
      // sections legitimately called "Overview" would otherwise both anchor to the first.
      const existing = attrs.match(/\sid="([^"]*)"/)?.[1];
      let id = existing || slugify(text) || `section-${found.length + 1}`;
      if (!existing) {
        let n = 2;
        const stem = id;
        while (used.has(id)) id = `${stem}-${n++}`;
      }
      used.add(id);
      found.push({ id, text, level: Number(lvl) as 2 | 3 });

      return existing ? match : `<h${lvl}${attrs} id="${escapeHtml(id)}">${inner}</h${lvl}>`;
    }
  );

  if (found.length < min) return none;

  const title = (settings.toc_title || "Contents").trim();
  const items = found
    .map(
      (h) =>
        `<li class="toc-l${h.level}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`
    )
    .join("");
  return {
    body,
    // <nav> rather than a bare div, and labelled — this is navigation, and a screen reader should
    // be able to skip it like any other nav.
    toc: `<nav class="toc" aria-label="${escapeHtml(title)}"><p class="toc-title">${escapeHtml(
      title
    )}</p><ul>${items}</ul></nav>`,
  };
}

export function renderPublicPostHtml(post: {
  id?: string;
  title: string;
  slug?: string | null;
  content_md: string;
  html?: string | null;
  excerpt?: string | null;
  featured_image_url?: string | null;
  published_at: string | null;
  category_name?: string | null;
  settings?: BlogSettings | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_index?: boolean;
  // Set on custom-domain requests so links/canonical point at that domain instead of the app.
  siteOrigin?: string | null;
  // Set by the owner-only preview routes. When present, internal links target the preview instead
  // of the real public paths — see the comment where `base` is computed.
  previewBase?: string | null;
  /** From the post's page_copy (contentWidthOf). Absent → the shared default. */
  content_width?: number | null;
  /** From the post's page_copy.theme. Absent → the pre-theme look, unchanged. */
  theme?: unknown;
}): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.affiliateoffersecrets.com";
  const origin = post.siteOrigin || appUrl;
  // On a custom domain the blog lives at the root, so paths drop the /b/{blogSlug} prefix.
  const onDomain = !!post.siteOrigin;
  // In preview, every internal link has to stay inside the preview. Pointing them at the real
  // public paths (which is what happened before) 404s on contact with reality: the public route
  // serves PUBLISHED posts only, so any draft link dead-ends, and a blog whose slug isn't set yet
  // has no public path at all — blogIndexPath returns null and the base collapses to "".
  const previewBase = post.previewBase || null;
  const base = previewBase ?? (onDomain ? "" : blogIndexPath(post.settings?.slug) ?? "");
  const style = post.settings?.permalink_style ?? "post";
  const postPath = onDomain
    ? blogPostPathOnDomain(post, style)
    : blogPostPath(post.settings?.slug, post.slug, post.id ?? "", post, style);
  const canonical = post.id || post.slug ? `${origin}${postPath}` : null;
  // Per-post SEO overrides (0032) win over the derived title/excerpt.
  const description = (post.seo_description || "").trim() || (post.excerpt || "").trim() || postExcerpt(post);
  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const byline = post.settings?.author_name ? `By ${post.settings.author_name}` : "";
  const meta = [byline, post.category_name, date]
    .filter(Boolean)
    .map((v) => escapeHtml(String(v)))
    .join(" · ");
  const seoTitle = (post.seo_title || "").trim() || post.title;
  const titleTag = post.settings?.blog_title ? `${seoTitle} — ${post.settings.blog_title}` : seoTitle;
  const { body, toc } = buildTableOfContents(
    post.html ?? renderPostContentHtml(post.content_md),
    post.settings
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titleTag)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ""}
${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ""}
${post.settings?.blog_title ? `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(post.settings.blog_title)}" href="${escapeHtml(`${base}/rss.xml`)}">` : ""}
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(seoTitle)}">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ""}
${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : ""}
${post.settings?.blog_title ? `<meta property="og:site_name" content="${escapeHtml(post.settings.blog_title)}">` : ""}
${post.published_at ? `<meta property="article:published_time" content="${escapeHtml(post.published_at)}">` : ""}
${post.featured_image_url ? `<meta property="og:image" content="${escapeHtml(post.featured_image_url)}">` : ""}
<meta name="twitter:card" content="${post.featured_image_url ? "summary_large_image" : "summary"}">
${post.seo_index === false ? '<meta name="robots" content="noindex, nofollow">' : ""}
<style>:root{--content-w:${contentWidthOf({ contentWidth: post.content_width ?? undefined })}px;${themeToCssVars(post.theme)}}${PUBLIC_CSS}</style>
</head>
<body>
${siteHeader(post.settings, base)}
<main>
  <h1 class="post-title">${escapeHtml(post.title)}</h1>
  ${meta ? `<div class="post-meta">${meta}</div>` : ""}
  ${post.featured_image_url ? `<img class="featured" src="${escapeHtml(post.featured_image_url)}" alt="${escapeHtml(post.title)}" />` : ""}
  ${toc}
  <article>${body}</article>
  ${authorBox(post.settings)}
</main>
</body>
</html>`;
}

export type BlogIndexPost = {
  id: string;
  title: string;
  slug: string | null;
  excerpt: string | null;
  content_md: string;
  html?: string | null;
  featured_image_url: string | null;
  published_at: string | null;
  category_name?: string | null;
  category_slug?: string | null;
};

// Fallback page size only — the real one is postsPerPage(settings), derived from the tenant's
// chosen columns x rows. Kept for callers that have no settings row to read (feeds use their
// own MAX_FEED_POSTS cap instead).
export const POSTS_PER_PAGE = 12;

export type BlogIndexCategory = { name: string; slug: string | null; description?: string | null };

// The blog index — published posts, newest first, paginated and optionally filtered to one
// category. Same self-contained/no-scripts shape as the post page (filter chips and the pager are
// plain links, no JS), sharing PUBLIC_CSS so the two never drift. `siteOrigin` is set on
// custom-domain requests: there the blog is the site root, so cards link to /{post-slug} instead
// of /b/{blog-slug}/{post-slug}.
export function renderBlogIndexHtml(
  settings: BlogSettings,
  posts: BlogIndexPost[],
  opts?: {
    siteOrigin?: string | null;
    /** Owner-only preview: rewrite every internal link to stay inside the preview. */
    previewBase?: string | null;
    categories?: BlogIndexCategory[];
    activeCategory?: BlogIndexCategory | null;
    page?: number;
    totalPages?: number;
  }
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.affiliateoffersecrets.com";
  const onDomain = !!opts?.siteOrigin;
  const origin = opts?.siteOrigin || appUrl;
  const previewBase = opts?.previewBase || null;
  const base = previewBase ?? (onDomain ? "" : blogIndexPath(settings.slug) ?? "");
  const page = Math.max(1, opts?.page ?? 1);
  const totalPages = Math.max(1, opts?.totalPages ?? 1);
  const activeCategory = opts?.activeCategory ?? null;
  const categories = opts?.categories ?? [];

  // Filter and page live in the query string rather than the path — avoids any chance of a
  // category slug shadowing a post slug, and keeps one canonical route per blog.
  const urlFor = (categorySlug: string | null, p: number) => {
    const qs = new URLSearchParams();
    if (categorySlug) qs.set("category", categorySlug);
    if (p > 1) qs.set("page", String(p));
    const q = qs.toString();
    return `${base || "/"}${q ? `?${q}` : ""}`;
  };

  const { layout, columns } = indexLayout(settings);

  const baseTitle = settings.blog_title || "Blog";
  // Filtered/paged views get a distinct <title> so search results and browser tabs aren't a wall
  // of identical entries.
  const title = [baseTitle, activeCategory ? activeCategory.name : null, page > 1 ? `Page ${page}` : null]
    .filter(Boolean)
    .join(" — ");
  const description = (settings.description || "").trim();

  const cards = posts
    .map((p) => {
      // In preview a card must open the PREVIEW of that post: it may be a draft, which the public
      // route refuses to serve, and it may have no public path at all if the blog slug is unset.
      const href = previewBase
        ? `${previewBase}/post/${p.id}`
        : onDomain
          ? blogPostPathOnDomain(p, settings.permalink_style)
          : blogPostPath(settings.slug, p.slug, p.id, p, settings.permalink_style);
      const excerpt = (p.excerpt || "").trim() || postExcerpt(p);
      const date = p.published_at
        ? new Date(p.published_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
        : "";
      const metaLine = [p.category_name, date].filter(Boolean).map((v) => escapeHtml(String(v))).join(" · ");
      const thumb = p.featured_image_url
        ? `<img src="${escapeHtml(p.featured_image_url)}" alt="${escapeHtml(p.title)}" />`
        : `<div class="ph"></div>`;
      return `<li class="post-card">
  <a class="thumb" href="${escapeHtml(href)}">${thumb}</a>
  <h2><a href="${escapeHtml(href)}">${escapeHtml(p.title)}</a></h2>
  ${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ""}
  ${metaLine ? `<div class="card-meta">${metaLine}</div>` : ""}
</li>`;
    })
    .join("\n");

  // Only rendered when the tenant actually has categories in use — a single "All" chip on its own
  // is noise.
  const categoryBar =
    categories.length > 0
      ? `<nav class="cat-bar">
  <a href="${escapeHtml(urlFor(null, 1))}"${!activeCategory ? ' aria-current="page"' : ""}>All</a>
  ${categories
    .filter((c) => c.slug)
    .map(
      (c) =>
        `<a href="${escapeHtml(urlFor(c.slug, 1))}"${
          activeCategory?.slug === c.slug ? ' aria-current="page"' : ""
        }>${escapeHtml(c.name)}</a>`
    )
    .join("\n  ")}
</nav>`
      : "";

  const pager =
    totalPages > 1
      ? `<nav class="pager">
  ${page > 1 ? `<a rel="prev" href="${escapeHtml(urlFor(activeCategory?.slug ?? null, page - 1))}">← Newer</a>` : "<span></span>"}
  <span class="page-of">Page ${page} of ${totalPages}</span>
  ${page < totalPages ? `<a rel="next" href="${escapeHtml(urlFor(activeCategory?.slug ?? null, page + 1))}">Older →</a>` : "<span></span>"}
</nav>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ""}
<link rel="canonical" href="${escapeHtml(origin + urlFor(activeCategory?.slug ?? null, page))}">
${page > 1 ? `<link rel="prev" href="${escapeHtml(origin + urlFor(activeCategory?.slug ?? null, page - 1))}">` : ""}
${page < totalPages ? `<link rel="next" href="${escapeHtml(origin + urlFor(activeCategory?.slug ?? null, page + 1))}">` : ""}
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(baseTitle)}" href="${escapeHtml(`${base}/rss.xml`)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ""}
<meta property="og:url" content="${escapeHtml(origin + urlFor(activeCategory?.slug ?? null, page))}">
<meta name="twitter:card" content="summary">
<style>${PUBLIC_CSS}</style>
</head>
<body>
${siteHeader(settings, base)}
<div class="index-wrap">
  ${settings.intro_html ? `<div class="home-intro">${settings.intro_html}</div>` : ""}
  ${categoryBar}
  ${
    activeCategory?.description
      ? `<p class="cat-desc">${escapeHtml(activeCategory.description)}</p>`
      : ""
  }
  ${
    posts.length === 0
      ? `<p class="empty">${
          activeCategory ? `No posts in ${escapeHtml(activeCategory.name)} yet.` : "No posts published yet."
        }</p>`
      : `<ul class="post-grid ${layout === "list" ? "as-list" : `cols-${columns}`}">${cards}</ul>`
  }
  ${pager}
  ${authorBox(settings)}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------------------------
// Feeds. Both are plain strings built with the same escapeHtml() used everywhere else — it
// escapes & < > " which is exactly what XML text nodes and double-quoted attributes need, so
// tenant-authored titles/excerpts can't break out of the document. No CDATA (which would need
// its own ]]> escaping); escaped text is the safer choice.
// ---------------------------------------------------------------------------------------------

// Cap well under the 50k sitemap limit — a blog this size wants a paginated sitemap index, which
// is deferred. Both feeds share the cap so they can't disagree about what exists.
export const MAX_FEED_POSTS = 1000;

function rfc822(date: string | null): string {
  return date ? new Date(date).toUTCString() : new Date(0).toUTCString();
}

// `base` is "" on a custom domain (blog is the site root) and "/b/{blog-slug}" on the app path —
// same convention as the HTML renderers.
export function renderRssXml(
  settings: BlogSettings,
  posts: BlogIndexPost[],
  origin: string,
  base: string
): string {
  const title = settings.blog_title || "Blog";
  const selfUrl = `${origin}${base}/rss.xml`;
  const items = posts
    .map((p) => {
      const url = `${origin}${base}/${postPathSuffix(settings.permalink_style, p)}`;
      const desc = (p.excerpt || "").trim() || postExcerpt(p);
      return `  <item>
    <title>${escapeHtml(p.title)}</title>
    <link>${escapeHtml(url)}</link>
    <guid isPermaLink="true">${escapeHtml(url)}</guid>
    <pubDate>${escapeHtml(rfc822(p.published_at))}</pubDate>
    ${p.category_name ? `<category>${escapeHtml(p.category_name)}</category>` : ""}
    ${desc ? `<description>${escapeHtml(desc)}</description>` : ""}
  </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeHtml(title)}</title>
  <link>${escapeHtml(origin + (base || "/"))}</link>
  <atom:link href="${escapeHtml(selfUrl)}" rel="self" type="application/rss+xml" />
  <description>${escapeHtml((settings.description || "").trim() || title)}</description>
  <language>en</language>
  <lastBuildDate>${escapeHtml(rfc822(posts[0]?.published_at ?? null))}</lastBuildDate>
${items}
</channel>
</rss>`;
}

export function renderSitemapXml(
  posts: BlogIndexPost[],
  origin: string,
  base: string,
  style?: PermalinkStyle | null
): string {
  const indexUrl = `${origin}${base || "/"}`;
  const urls = [
    `  <url><loc>${escapeHtml(indexUrl)}</loc><changefreq>daily</changefreq></url>`,
    ...posts.map((p) => {
      const url = `${origin}${base}/${postPathSuffix(style, p)}`;
      const lastmod = p.published_at ? new Date(p.published_at).toISOString().slice(0, 10) : null;
      return `  <url><loc>${escapeHtml(url)}</loc>${
        lastmod ? `<lastmod>${escapeHtml(lastmod)}</lastmod>` : ""
      }</url>`;
    }),
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export { renderBlockTree };
