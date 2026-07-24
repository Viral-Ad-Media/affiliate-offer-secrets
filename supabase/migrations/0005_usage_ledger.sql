-- Cost audit trail for the automated engine — every Anthropic API call the worker makes is
-- logged here with exact token counts and computed dollar cost, so a client can see precisely
-- what their jobs cost to run (surfaced on /billing). Insert-only from the service-role worker;
-- clients can read their own rows.

create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  job_type text not null,
  stage text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index usage_ledger_user_id_created_at_idx on public.usage_ledger (user_id, created_at desc);

alter table public.usage_ledger enable row level security;

create policy "own usage" on public.usage_ledger
  for select using (auth.uid() = user_id);

-- No insert/update/delete policy for authenticated/anon — only the service-role worker writes
-- here, same trust boundary as credits_ledger and payments.
