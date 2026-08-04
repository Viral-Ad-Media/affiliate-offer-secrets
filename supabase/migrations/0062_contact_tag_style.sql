-- Tags gain a colour and a description. 0047 gave them a name and nothing else, which is enough to
-- group by but not enough to scan: once a tenant has a dozen tags, a wall of identical grey chips
-- on the leads table carries almost no information at a glance.
--
-- The colour is CHECK-constrained to a fully-anchored 6-digit hex literal, and that constraint is
-- the load-bearing half of the defence, not input hygiene. This value ends up inside a
-- style/backgroundColor on a rendered chip, so an unconstrained string is the same CSS-injection
-- shape that lib/engine/blockTree.ts's styleToInlineCss() closes off by construction and that
-- lib/images/validate.ts's anchored regex closes off for image_data_url. The API route validates
-- with the identical anchored pattern; both layers are kept deliberately, matching this codebase's
-- established habit for this bug class. NULL means "no colour chosen" and renders as today's
-- neutral chip — so every pre-existing tag keeps working with no backfill.
alter table public.contact_tags
  add column if not exists color text,
  add column if not exists description text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contact_tags_color_hex'
  ) then
    alter table public.contact_tags
      add constraint contact_tags_color_hex
      check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
  end if;

  -- A description is a note to the operator ("people who clicked but didn't buy"), never rendered
  -- to a visitor, so a length cap is all it needs. Capped rather than unbounded for the same reason
  -- every other free-text column here is: an unbounded column is an unbounded row.
  if not exists (
    select 1 from pg_constraint where conname = 'contact_tags_description_len'
  ) then
    alter table public.contact_tags
      add constraint contact_tags_description_len
      check (description is null or char_length(description) <= 200);
  end if;
end $$;
