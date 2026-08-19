-- Superadmin job tools beyond requeue/fail (0055): preview a job's full contents, edit its
-- payload, and delete it. Same shape as every admin_* function — SECURITY DEFINER, first
-- statement assert_superadmin(), audit row in the same transaction as the effect, granted to
-- authenticated (the assert is the gate, so no service-role key is involved).

-- On-demand full view of ONE job for the preview dialog. A separate function rather than extra
-- columns on the list read: stage_data regularly carries the whole extracted sales-page text
-- (~6 kB+) and image-candidate lists, and the dashboard list would re-send that for every row.
create or replace function public.admin_job_detail(p_job_id uuid)
returns table (
  id uuid,
  user_id uuid,
  workspace_id uuid,
  type text,
  status text,
  stage int,
  attempts int,
  payload jsonb,
  stage_data jsonb,
  result text,
  locked_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_superadmin();
  return query
    select j.id, j.user_id, j.workspace_id, j.type, j.status, j.stage, j.attempts,
           j.payload, j.stage_data, j.result, j.locked_at, j.created_at, j.updated_at
      from public.jobs j
     where j.id = p_job_id;
end;
$$;

-- Fix a bad payload (a forged/typo'd reference, a wrong count) so a requeue can succeed.
-- REFUSED while the job is running: the worker may already hold the old payload in memory, and
-- editing under it would make the job half-old-half-new. The audit row keeps the payload it
-- replaced, so the edit is reversible by hand and the trail shows exactly what changed.
create or replace function public.admin_update_job_payload(p_job_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_status text;
  v_old jsonb;
begin
  perform public.assert_superadmin();

  select user_id, status, payload into v_user, v_status, v_old
    from public.jobs where id = p_job_id for update;
  if v_user is null then
    raise exception 'no such job';
  end if;
  if v_status = 'running' then
    raise exception 'job is running — wait for it to finish or fail it first';
  end if;

  update public.jobs set payload = p_payload, updated_at = now() where id = p_job_id;

  insert into public.admin_actions (actor_user_id, action, target_user_id, detail)
  values (auth.uid(), 'edit_job_payload', v_user,
          jsonb_build_object('job_id', p_job_id, 'old_payload', v_old, 'new_payload', p_payload));
end;
$$;

-- Delete a job outright — for queue garbage a requeue can never fix (a job type that no longer
-- exists, a payload referencing deleted rows). REFUSED while running, same reason as the edit.
--
-- ORDER IS LOAD-BEARING: the refund runs BEFORE the delete. credits_ledger.job_id is
-- ON DELETE SET NULL (measured, not assumed), so after the delete the original debit row no
-- longer carries the key refund_job_credits mirrors — a delete-then-refund would silently refund
-- nothing. refund_job_credits is idempotent and refunds only what was actually charged, so a
-- never-charged or already-refunded job deletes cleanly with no double credit.
create or replace function public.admin_delete_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_status text;
  v_type text;
begin
  perform public.assert_superadmin();

  select user_id, status, type into v_user, v_status, v_type
    from public.jobs where id = p_job_id for update;
  if v_user is null then
    raise exception 'no such job';
  end if;
  if v_status = 'running' then
    raise exception 'job is running — wait for it to finish or fail it first';
  end if;

  perform public.refund_job_credits(p_job_id, 'refund: job deleted by an administrator');

  delete from public.jobs where id = p_job_id;

  insert into public.admin_actions (actor_user_id, action, target_user_id, detail)
  values (auth.uid(), 'delete_job', v_user,
          jsonb_build_object('job_id', p_job_id, 'type', v_type, 'status_at_delete', v_status));
end;
$$;

revoke execute on function public.admin_job_detail(uuid) from public, anon;
revoke execute on function public.admin_update_job_payload(uuid, jsonb) from public, anon;
revoke execute on function public.admin_delete_job(uuid) from public, anon;

grant execute on function public.admin_job_detail(uuid) to authenticated;
grant execute on function public.admin_update_job_payload(uuid, jsonb) to authenticated;
grant execute on function public.admin_delete_job(uuid) to authenticated;
