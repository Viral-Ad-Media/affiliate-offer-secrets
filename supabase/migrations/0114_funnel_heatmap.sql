-- Native click/scroll heatmaps for funnel pages: a DENSITY GRID, not an event log. One counter
-- row per (campaign, page, kind, cell) — clicks bucket into a 40-column × 100-row grid (x as % of
-- viewport width, y as % of document height), scroll into 10 max-depth deciles — so storage is
-- hard-capped at ~4000 rows per page no matter how much traffic arrives. The same bounded-counter
-- stance as funnel_page_stats (0110): spam can tilt a picture but can never grow the table, there
-- is no PII, and nothing needs erasure. Raw x/y event rows were considered and rejected — they
-- grow with traffic on an anonymous write path, which is the one thing this app's public
-- endpoints are designed never to do.
--
-- Blog posts deliberately have NO native layer: public blog pages ship zero JavaScript (the
-- carousel is CSS-only to protect exactly that), so posts use the Clarity integration instead.
create table public.funnel_heatmap_cells (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  page_key text not null check (page_key ~ '^[a-z0-9-]{1,40}$'),
  kind text not null check (kind in ('click', 'scroll')),
  cell_x int not null check (cell_x between 0 and 39),
  cell_y int not null check (cell_y between 0 and 99),
  count bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (campaign_id, page_key, kind, cell_x, cell_y)
);

alter table public.funnel_heatmap_cells enable row level security;

create policy funnel_heatmap_cells_select on public.funnel_heatmap_cells
  for select using (public.is_workspace_member(workspace_id));

revoke insert, update, delete on public.funnel_heatmap_cells from anon, authenticated;

-- Batched increment: one beacon carries a click cell (and, on leave, a scroll decile), so the
-- function takes a small array rather than being called per cell. Hard-capped at 8 elements —
-- a legitimate beacon never sends more than 2 — and every value is re-validated here, because
-- the caller is a public route fed by anonymous browsers. Unknown campaign: silent no-op.
create or replace function public.increment_funnel_heatmap_cells(
  p_campaign_id uuid,
  p_page_key text,
  p_cells jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  cell jsonb;
  v_kind text;
  v_x int;
  v_y int;
begin
  if p_page_key !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'invalid page key';
  end if;
  if jsonb_typeof(p_cells) <> 'array' or jsonb_array_length(p_cells) > 8 then
    raise exception 'invalid cells';
  end if;
  select workspace_id into v_ws from public.campaigns where id = p_campaign_id;
  if v_ws is null then
    return;
  end if;

  for cell in select * from jsonb_array_elements(p_cells) loop
    v_kind := cell ->> 'k';
    v_x := (cell ->> 'x')::int;
    v_y := (cell ->> 'y')::int;
    if v_kind not in ('click', 'scroll') then continue; end if;
    if v_x is null or v_y is null or v_x < 0 or v_x > 39 or v_y < 0 or v_y > 99 then continue; end if;

    insert into public.funnel_heatmap_cells (workspace_id, campaign_id, page_key, kind, cell_x, cell_y, count)
    values (v_ws, p_campaign_id, p_page_key, v_kind, v_x, v_y, 1)
    on conflict (campaign_id, page_key, kind, cell_x, cell_y) do update
      set count = public.funnel_heatmap_cells.count + 1,
          updated_at = now();
  end loop;
end;
$$;

revoke all on function public.increment_funnel_heatmap_cells(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.increment_funnel_heatmap_cells(uuid, text, jsonb) to service_role;
