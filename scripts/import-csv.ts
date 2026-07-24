/**
 * Import a clickbank-engine master CSV (the Drive schema) into a tenant's product list.
 *
 *   npm run import-csv -- <path-to-clickbank-products.csv> --user <uuid>
 *
 * Columns expected (exact order of the Drive master CSV):
 * date_added,niche,vendor_id,product_title,description,gravity,initial_sale,avg_sale,
 * recurring,commission_pct,sales_page_url,affiliate_page_url,hoplink,score,angle_notes,status,assets_link
 * Dedupes on (user_id, vendor_id); fresh stats win, existing status is kept.
 */
import fs from "fs";
import { createAdminClient } from "../lib/supabase/admin";

const file = process.argv[2];
const userIdx = process.argv.indexOf("--user");
const userId = userIdx > -1 ? process.argv[userIdx + 1] : undefined;

if (!file || !fs.existsSync(file) || !userId) {
  console.error("Usage: npm run import-csv -- <path-to-csv> --user <uuid>");
  process.exit(1);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((v) => v !== "")) rows.push(row);
  }
  return rows;
}

async function main() {
  const db = createAdminClient();
  const rows = parseCsv(fs.readFileSync(file!, "utf8"));
  const header = rows.shift()!;
  const idx = (name: string) => header.indexOf(name);
  const num = (v: string) => (v === "" || v == null ? null : Number(v));

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const vendorId = r[idx("vendor_id")];
    if (!vendorId) continue;
    const values = {
      user_id: userId,
      date_added: r[idx("date_added")] || null,
      niche: r[idx("niche")] || "unknown",
      vendor_id: vendorId,
      product_title: r[idx("product_title")],
      description: r[idx("description")] || null,
      gravity: num(r[idx("gravity")]),
      initial_sale: num(r[idx("initial_sale")]),
      avg_sale: num(r[idx("avg_sale")]),
      recurring: num(r[idx("recurring")]),
      commission_pct: num(r[idx("commission_pct")]),
      sales_page_url: r[idx("sales_page_url")] || null,
      affiliate_page_url: r[idx("affiliate_page_url")] || null,
      hoplink: r[idx("hoplink")] || null,
      score: num(r[idx("score")]),
      angle_notes: r[idx("angle_notes")] || null,
      page_verified: /verified live/i.test(r[idx("angle_notes")] || ""),
      status: r[idx("status")] || "New",
      assets_link: r[idx("assets_link")] || null,
    };

    const { data: existing } = await db
      .from("products")
      .select("id")
      .eq("user_id", userId)
      .ilike("vendor_id", vendorId)
      .maybeSingle();

    if (existing) {
      const { assets_link, ...rest } = values;
      await db
        .from("products")
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (assets_link) {
        await db.from("products").update({ assets_link }).eq("id", existing.id).is("assets_link", null);
      }
      updated++;
    } else {
      await db.from("products").insert(values);
      created++;
    }
  }

  console.log(JSON.stringify({ ok: true, created, updated }));
}

main();
