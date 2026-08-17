import { NextResponse } from "next/server";
import { queueChargedJob } from "@/lib/credits";
import { resolveGenerationModel } from "@/lib/generationSettings";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Nominal runaway-loop backstop, same framing as the other generation caps in this codebase —
// not a budget control, just a ceiling a genuine retry loop can't blow past.
const MAX_BLOG_IMAGES_PER_DAY = 100;

// Queues a generate_blog_image job (lib/engine/blogimage.ts). The existing pg_net insert trigger
// + pg_cron backstop pick up any jobs row generically, so nothing new is needed to drain it.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  // RLS-scoped read doubles as the ownership check; the worker's stageVerify re-checks for real.
  const { data: post } = await supabase
    .from("blog_posts")
    .select("id, featured_image_status")
    .eq("id", params.id)
    .maybeSingle();
  if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });
  if (post.featured_image_status === "generating") {
    return NextResponse.json({ error: "an image is already generating for this post" }, { status: 409 });
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .eq("type", "generate_blog_image")
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_BLOG_IMAGES_PER_DAY) {
    return NextResponse.json({ error: "daily image-generation limit reached — try again tomorrow" }, { status: 429 });
  }

  // Claim first so a double-click can't queue two jobs; roll back if the insert then fails.
  const { data: claimed } = await admin
    .from("blog_posts")
    .update({ featured_image_status: "generating", featured_image_error: null, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .neq("featured_image_status", "generating")
    .select("id")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ error: "an image is already generating for this post" }, { status: 409 });

  // Resolved at QUEUE time so the job records the model it was queued with — the worker
  // re-runs stages on retry, and reading settings there could repoint a job mid-flight.
  // Body is optional on these routes — they were POST-with-no-body until models became
  // selectable, and every existing caller still sends none. A parse failure means "no override".
  const overrideModel: unknown = await req
    .json()
    .then((b: unknown) => (b as { model?: unknown } | null)?.model)
    .catch(() => undefined);
  const chosenModel = await resolveGenerationModel(supabase, ws, "image", overrideModel);

  const queued = await queueChargedJob(
    supabase,
    { workspace_id: ws, type: "generate_blog_image", payload: { post_id: params.id, model_id: chosenModel.id } },
    {
      onRollback: async () => {
        await admin.from("blog_posts").update({ featured_image_status: "none" }).eq("id", params.id);
      },
    }
  );
  if (!queued.ok) return NextResponse.json(queued.body, { status: queued.status });

  return NextResponse.json({ ok: true, charged: queued.charged });
}
