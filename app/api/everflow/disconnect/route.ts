import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Disconnect: drop the connection row, delete the key from Vault, and remove the affiliate id.
// Leaving the Vault secret behind would keep a live, usable API key in the database for a
// connection the user believes they removed.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("everflow_connections")
    .select("api_key_secret_id")
    .eq("user_id", user.id)
    .maybeSingle();

  await admin.from("everflow_connections").delete().eq("user_id", user.id);
  if (existing?.api_key_secret_id) {
    await admin.rpc("delete_oauth_secret", { p_secret_id: existing.api_key_secret_id });
  }
  await admin.from("network_connections").delete().eq("user_id", user.id).eq("network", "everflow");

  return NextResponse.json({ ok: true });
}
