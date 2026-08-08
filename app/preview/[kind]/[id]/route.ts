import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * A real, stable URL for a FUNNEL page (opt-in or step) from the moment it is generated — not from
 * the moment it is published.
 *
 * Blog posts deliberately do NOT route through here: `/api/blog/preview/post/[id]` already does
 * exactly this for them, with `page_copy`/`seo_index` handling and a `previewBase` that keeps
 * internal links inside the preview. A second path for the same job is the thing this codebase
 * avoids; the blog editor's draft link points at that route.
 *
 * The public routes (`/p/{id}/bridge`, `/b/{blog}/{post}`) gate on `bridge_published` /
 * `status='published'` and answer a generic 404 before that, deliberately: an unfinished page must
 * not be reachable by ad traffic or a crawler. That gate is unchanged. This is a second, private
 * URL that answers the other question — "let me look at the thing I just made" — and it is
 * **signed in only**:
 *
 *   - It is NOT in middleware's PUBLIC_EXACT_PATHS/PUBLIC_PREFIX_PATHS, so the auth gate redirects
 *     an anonymous request to /login before this handler ever runs. Everything not listed there is
 *     gated by default; do not add `/preview` to either list.
 *   - It reads through the RLS-scoped client AND filters on the active workspace, the standing
 *     belt-and-braces rule — so a signed-in member of another workspace gets the same 404 as a
 *     stranger, not someone else's draft.
 *
 * **The page is served inside `sandbox=""`, and that is the point, not an implementation detail.**
 * These pages carry the tenant's own Meta Pixel and a lead form that POSTs to the real
 * `/api/public/leads` on this very origin. Served as an ordinary document, looking at your own
 * draft would fire live pixels and could write a real contact row — a preview that changes your
 * analytics is not a preview. An empty sandbox runs no scripts and submits no forms, so it is a
 * look at the page, exactly like the blob:-based editor preview it matches. The trade, same as
 * that one: script-driven blocks (a countdown) sit still here.
 */
function sandboxDocument(html: string, title: string): string {
  const srcdoc = html
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Preview — ${safeTitle}</title>
<style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style>
</head>
<body><iframe sandbox="" srcdoc="${srcdoc}"></iframe></body>
</html>`;
}

const NOT_FOUND = new NextResponse("Not found", { status: 404 });

function page(html: string, title: string) {
  return new NextResponse(sandboxDocument(html, title), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Belt and braces with the auth gate: a draft must never be indexed even if it somehow
      // reached a crawler, and a preview must never be a cached copy of a page you just edited.
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

export async function GET(_req: Request, { params }: { params: { kind: string; id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NOT_FOUND;

  const ws = await currentWorkspaceId();
  if (!ws) return NOT_FOUND;

  if (params.kind === "funnel") {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("bridge_html, name, products(product_title)")
      .eq("id", params.id)
      .eq("workspace_id", ws)
      .maybeSingle();
    if (!campaign?.bridge_html) return NOT_FOUND;
    const title =
      ((campaign as any).products?.product_title as string | undefined) ??
      ((campaign as any).name as string | null) ??
      "Funnel";
    return page(campaign.bridge_html as string, title);
  }

  if (params.kind === "step") {
    const { data: step } = await supabase
      .from("funnel_steps")
      .select("html, step_type, step_index")
      .eq("id", params.id)
      .eq("workspace_id", ws)
      .maybeSingle();
    if (!step?.html) return NOT_FOUND;
    return page(step.html as string, `Step ${step.step_index} — ${step.step_type}`);
  }

  return NOT_FOUND;
}
