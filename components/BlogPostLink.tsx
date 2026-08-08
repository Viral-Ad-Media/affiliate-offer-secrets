"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Eye, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Edit / Preview for the blog post a finished kit already created.
 *
 * `finalizeBuildCampaign` writes the kit's article into `blog_posts` as a DRAFT the moment a build
 * finishes (lib/blog/fromCampaign.ts) — but this tab only ever showed the raw markdown, so the
 * post it produced was invisible from here. You had to know it existed and go find it under Blog.
 *
 * Reads through the browser client against `blog_posts`' owner-select RLS rather than widening
 * `/api/products/[id]`'s payload — that route is polled and was just trimmed for exactly that
 * reason, and this is one small row fetched once.
 */
export default function BlogPostLink({ campaignId }: { campaignId: string }) {
  const [post, setPost] = useState<{ id: string; status: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("blog_posts")
        .select("id, status")
        .eq("campaign_id", campaignId)
        .maybeSingle();
      if (!cancelled) {
        setPost((data as { id: string; status: string } | null) ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (loading) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for this kit&apos;s blog post…
      </p>
    );
  }

  // No post is a real, explainable state, not an error: unticking "Blog article" in the Build kit
  // dialog means no blog_md was generated, so nothing was created to link to.
  if (!post) {
    return (
      <p className="text-xs text-zinc-500">
        No blog post for this kit yet — rebuild with &ldquo;Blog article&rdquo; ticked and one is
        created as a draft automatically.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        className={
          post.status === "published"
            ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
            : "border-ink-600 bg-ink-800 text-zinc-400"
        }
      >
        {post.status === "published" ? "Published" : "Draft"}
      </Badge>
      <Link href={`/blog/${post.id}`} className={cn(buttonVariants({ variant: "outline" }), "text-xs")}>
        <Pencil className="h-3.5 w-3.5" /> Edit post
      </Link>
      {/* The existing owner-only preview route — signed in, noindex, and it renders through the
          same function the public blog uses, so a draft looks exactly like it will published. */}
      <a
        href={`/api/blog/preview/post/${post.id}`}
        target="_blank"
        rel="noreferrer"
        className={cn(buttonVariants({ variant: "outline" }), "text-xs")}
      >
        <Eye className="h-3.5 w-3.5" /> Preview post
      </a>
      <span className="text-xs text-zinc-500">
        Editing the post never changes this kit&apos;s article — the import copied it.
      </span>
    </div>
  );
}
