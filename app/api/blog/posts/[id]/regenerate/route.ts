import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeJSON, COMPLIANCE_SYSTEM } from "@/lib/engine/anthropic";
import { markdownToBlockTree, blogRenderCtx, renderBlockTree, MAX_POST_EXCERPT } from "@/lib/blog";
import { snapshotOf } from "@/lib/blogRevision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Rewrite a post's body with AI, keeping its title.
 *
 * Synchronous rather than a queued job, for the same reason the broadcast composer is: this is one
 * Anthropic call feeding an editor someone is sitting in front of, and a job would mean pressing a
 * button, leaving, and coming back.
 *
 * NOT credit-charged, deliberately, and for the same reason: every charged action in this app is
 * keyed on a job id, and that key is what makes charging safe against double-clicks and worker
 * retries. A synchronous helper has no such key. Token cost is still recorded in usage_ledger by
 * completeJSON. If this ever needs a price, give it an idempotency key first — don't bolt on an
 * unguarded debit.
 *
 * The current version is snapshotted BEFORE the model is called, so a regeneration you dislike is
 * always one click from being undone. That's what makes the button safe to press.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  // RLS-scoped read is the ownership check — a post in another workspace simply isn't visible.
  const { data: post } = await supabase
    .from("blog_posts")
    .select("id, title, content_md, html, excerpt, seo_title, seo_description, featured_image_url, slug")
    .eq("id", params.id)
    .maybeSingle();
  if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const instruction =
    typeof body.instruction === "string" ? body.instruction.trim().slice(0, 400) : "";

  const result = await completeJSON<{ content_md: string; excerpt: string }>({
    system: COMPLIANCE_SYSTEM,
    schema: {
      type: "object",
      properties: {
        content_md: {
          type: "string",
          description:
            "The full post body in Markdown. Use ## for section headings. No H1 — the title is rendered separately.",
        },
        excerpt: { type: "string", description: "A one-sentence summary, under 160 characters." },
      },
      required: ["content_md", "excerpt"],
    },
    prompt: [
      `Rewrite this blog post. Keep the title and the subject; improve the writing.`,
      `Title: ${post.title}`,
      instruction ? `Specific instruction from the author: ${instruction}` : "",
      ``,
      `Current post:`,
      (post.content_md ?? "").slice(0, 12_000),
      ``,
      `Requirements:`,
      `- At least 3 "##" section headings, so the post is scannable and can build a contents list.`,
      `- Keep any existing links, including affiliate links, and keep them in context.`,
      `- No invented statistics, studies, testimonials or results. If the current post claims`,
      `  something specific you cannot verify from it, rephrase rather than inventing support.`,
    ]
      .filter(Boolean)
      .join("\n"),
    usage: { userId: user.id, jobId: null, jobType: "blog_post_regenerate", stage: "rewrite" },
  });

  const contentMd = (result.content_md ?? "").trim();
  if (!contentMd) return NextResponse.json({ error: "Generation returned nothing" }, { status: 502 });

  // Rendered here, not on next save: html is what the public page serves, and leaving it stale
  // would mean the preview showed new copy while the live post kept the old.
  const tree = markdownToBlockTree(contentMd, { dropFirstH1: true });
  const html = renderBlockTree(tree, blogRenderCtx());

  const admin = createAdminClient();
  const { error } = await admin
    .from("blog_posts")
    .update({
      previous_version: snapshotOf(post),
      previous_saved_at: new Date().toISOString(),
      content_md: contentMd,
      html,
      excerpt: (result.excerpt ?? "").trim().slice(0, MAX_POST_EXCERPT) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("workspace_id", ws);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, content_md: contentMd, excerpt: result.excerpt ?? "" });
}
