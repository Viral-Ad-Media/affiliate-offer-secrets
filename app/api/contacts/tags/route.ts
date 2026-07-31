import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAX_TAG_NAME = 60;

// Create a contact tag. Writes go through the admin client (contact_tags has no client write
// grants, 0047); user_id always comes from the live session, never the body.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_TAG_NAME) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contact_tags")
    .insert({ user_id: user.id, name })
    .select("id, name")
    .single();
  if (error) {
    const dup = error.code === "23505" || error.message.includes("duplicate");
    return NextResponse.json(
      { error: dup ? "You already have a tag with that name" : error.message },
      { status: dup ? 409 : 500 }
    );
  }
  return NextResponse.json({ ok: true, tag: data });
}
