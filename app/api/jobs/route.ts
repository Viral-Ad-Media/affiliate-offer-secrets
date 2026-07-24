import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CLICKBANK_CATEGORIES } from "@/lib/categories";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(jobs);
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json();
  if (body.type !== "discover_products") {
    return NextResponse.json({ error: "unknown job type" }, { status: 400 });
  }

  const count = Number(body.count) || 10;
  const mode = body.mode === "keyword" ? "keyword" : "category";

  let payload: Record<string, unknown>;
  if (mode === "keyword") {
    const keyword = (body.keyword ?? "").trim();
    if (!keyword) return NextResponse.json({ error: "keyword required" }, { status: 400 });
    payload = { mode: "keyword", keyword, niche: keyword, count };
  } else {
    const category = CLICKBANK_CATEGORIES.find((c) => c.name === body.category);
    if (!category) return NextResponse.json({ error: "unknown category" }, { status: 400 });
    const subCategory =
      body.subCategory && category.subCategories.includes(body.subCategory)
        ? body.subCategory
        : undefined;
    const niche = subCategory ? `${category.name} > ${subCategory}` : category.name;
    payload = { mode: "category", category: category.name, subCategory, niche, count };
  }

  // jsonb equality via PostgREST wants the JSON-encoded string as the filter value.
  const { data: open } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", user.id)
    .eq("type", "discover_products")
    .in("status", ["pending", "running"])
    .filter("payload", "eq", JSON.stringify(payload))
    .maybeSingle();
  if (open) return NextResponse.json({ ok: true, job_id: open.id, deduped: true });

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({ user_id: user.id, type: "discover_products", payload })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, job_id: job.id });
}
