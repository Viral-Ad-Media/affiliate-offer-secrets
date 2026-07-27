-- Design-review fix: a "poll, not ready yet" stage outcome needs its own mechanism, distinct from
-- both a normal stage-advance and a thrown error. claim_job() increments `attempts` on every
-- claim, including a stale-reclaim (locked_at older than 90s) -- with no fix, a long-running
-- generate_video job that's still legitimately waiting gets reclaimed roughly every 90-150s and
-- its attempts climbs to MAX_ATTEMPTS (5) in ~8-12 minutes, well inside what's a NORMAL Veo wait,
-- terminally failing a job that may have been about to finish. This RPC lets a "not ready" poll
-- refresh the staleness window (locked_at) while cancelling out the attempts increment
-- claim_job() just made for this claim, so waiting alone never counts toward the failure cap.
-- service_role only -- same trust tier as claim_job() itself, no ownership check needed/possible
-- (workers process jobs across all tenants).
create or replace function public.heartbeat_job_retry(p_job_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.jobs
  set locked_at = now(), attempts = greatest(attempts - 1, 0)
  where id = p_job_id;
$$;

revoke execute on function public.heartbeat_job_retry(uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_job_retry(uuid) to service_role;
