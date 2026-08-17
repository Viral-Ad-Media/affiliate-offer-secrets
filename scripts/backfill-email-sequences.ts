/**
 * Creates the draft email sequence for kits built BEFORE auto-create existed.
 *
 * finalizeBuildCampaign now turns a kit's email swipes into a draft sequence the way it already
 * turns its article into a draft post — but only for builds from here on. Campaigns built earlier
 * carry their `email_md` with nowhere for it to show up, which is the same invisibility this was
 * meant to fix.
 *
 * Idempotent (createSequenceFromCampaign upserts on source_campaign_id and refuses to touch a
 * sequence that is no longer a draft), so it is safe to re-run.
 *
 * Run:  npm run backfill-email-sequences            (dry run — lists what it would create)
 *       npm run backfill-email-sequences -- --apply
 */
import { createClient } from "@supabase/supabase-js";
import { createSequenceFromCampaign, parseEmailMd } from "../lib/broadcast/fromCampaign";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Supabase env missing — run via the npm script, which loads .env.local");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const apply = process.argv.includes("--apply");
  const { data: campaigns, error } = await admin
    .from("campaigns")
    .select("id, workspace_id, email_md, products(product_title)")
    .not("email_md", "is", null);
  if (error) throw error;

  let created = 0;
  let skipped = 0;
  for (const c of campaigns ?? []) {
    const title = ((c as any).products?.product_title as string | undefined) ?? c.id;
    const emails = parseEmailMd(c.email_md as string);
    if (emails.length === 0) {
      console.log(`skip    ${title} — no parseable emails`);
      skipped++;
      continue;
    }
    if (!apply) {
      console.log(`would   ${title} — ${emails.length} emails`);
      continue;
    }
    try {
      const r = await createSequenceFromCampaign(admin, c.workspace_id as string, c.id as string);
      if (r?.created) {
        created++;
        console.log(`created ${title} — ${r.steps} steps`);
      } else {
        skipped++;
        console.log(`skip    ${title} — already has a sequence`);
      }
    } catch (e) {
      skipped++;
      console.error(`FAILED  ${title} — ${(e as Error).message}`);
    }
  }
  console.log(
    apply
      ? `\ncreated ${created}, skipped ${skipped}`
      : `\ndry run over ${(campaigns ?? []).length} campaigns — re-run with --apply`
  );
}

main();
