-- Phase O.5: real form-input backend wiring. A block-tree lead-capture form can now hold
-- user-added `form_input` fields (lib/engine/blockTree.ts) beyond the fixed first_name/email —
-- this column is where their submitted values land. Same 100%-app-layer-enforced shape as
-- page_copy/stage_data/fb_ad_angles: no CHECK constraint here, since the set of legitimate keys
-- is dynamic (whatever the tenant's current lead_capture_form block happens to contain) and is
-- validated at write time in app/api/public/leads/route.ts via
-- lib/engine/validatePageBlockTree.ts's extractLeadFormFields(), not by the database.
alter table public.contacts add column extra_fields jsonb not null default '{}'::jsonb;
