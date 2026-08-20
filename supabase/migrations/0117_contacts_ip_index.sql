-- Per-IP rate limiting on /api/public/leads counts contacts by (ip_address, created_at) across all
-- campaigns. contacts already stores ip_address; this index keeps those two new COUNT queries cheap
-- as the table grows from real paid traffic. Partial (ip_address not null) because the route never
-- filters on a null IP — a stripped x-forwarded-for skips the per-IP check entirely.
create index if not exists contacts_ip_created_idx
  on public.contacts (ip_address, created_at)
  where ip_address is not null;
