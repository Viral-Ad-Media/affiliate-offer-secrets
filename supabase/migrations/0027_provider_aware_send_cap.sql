-- The pooled 300/day send cap exists to protect a personal mailbox from being flagged/suspended
-- (Gmail's free tier is ~500/day). It never made sense for transactional providers — Resend/
-- SendGrid/Mailgun accounts are built for volume and carry their own plan limits. This makes the
-- cap provider-aware: it applies only when the account's active sender is a personal mailbox —
-- Gmail OAuth, or a generic SMTP connection pointed at a Gmail/Yahoo host. Everything else is
-- uncapped here (the provider's own limits are the real ceiling).

create or replace function public.is_capped_mail_sender(p_user_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_provider text;
  v_host text;
begin
  select active_mail_provider into v_provider from public.profiles where id = p_user_id;
  -- Null/missing profile or explicit gmail -> capped (gmail is the default and the reason the
  -- cap exists).
  if v_provider is null or v_provider = 'gmail' then
    return true;
  end if;
  if v_provider = 'smtp' then
    select smtp_host into v_host
    from public.mail_provider_connections
    where user_id = p_user_id and provider = 'smtp';
    -- An SMTP connection aimed at a personal-mailbox host gets the same protection as Gmail
    -- OAuth; unknown/missing host fails safe to capped.
    return v_host is null
      or v_host ilike '%gmail%'
      or v_host ilike '%googlemail%'
      or v_host ilike '%yahoo%';
  end if;
  -- resend / sendgrid / mailgun
  return false;
end;
$$;

revoke execute on function public.is_capped_mail_sender(uuid) from public, anon, authenticated;
grant execute on function public.is_capped_mail_sender(uuid) to service_role;

-- Same function as 0021, with the admission-control cap applied only to capped senders. The
-- 1,000,000 stand-in for "uncapped" keeps the LIMIT clause shape (and doubles as an absurd
-- runaway backstop) rather than duplicating the claim loop.
create or replace function public.run_broadcast_sweep()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_enrolled integer := 0; v_seq record; v_queued integer := 0;
  v_user record; v_remaining integer; v_step record; v_job_id uuid;
begin
  for v_seq in select id from public.broadcast_sequences where status = 'active' loop
    v_enrolled := v_enrolled + public.enroll_broadcast_sequence_contacts(v_seq.id);
  end loop;

  for v_user in
    select distinct bes.user_id from public.broadcast_enrollment_steps bes
    where bes.status = 'pending' and bes.due_at <= now()
  loop
    if public.is_capped_mail_sender(v_user.user_id) then
      select greatest(0, 300 - (
        (select count(*) from public.mail_sends where user_id = v_user.user_id and created_at >= now() - interval '24 hours')
        + (select count(*) from public.broadcast_sends where user_id = v_user.user_id and status = 'sent' and created_at >= now() - interval '24 hours')
      )) into v_remaining;
    else
      v_remaining := 1000000;
    end if;

    if v_remaining > 0 then
      for v_step in
        select bes.id from public.broadcast_enrollment_steps bes
        join public.broadcast_enrollments e on e.id = bes.enrollment_id
        where bes.user_id = v_user.user_id and bes.status = 'pending' and bes.due_at <= now() and e.status = 'active'
        order by bes.due_at asc limit v_remaining
      loop
        update public.broadcast_enrollment_steps set status = 'queued', updated_at = now()
        where id = v_step.id and status = 'pending';
        if found then
          insert into public.jobs (user_id, type, payload, status)
          values (v_user.user_id, 'send_broadcast_email', jsonb_build_object('enrollment_step_id', v_step.id), 'pending')
          returning id into v_job_id;
          update public.broadcast_enrollment_steps set job_id = v_job_id where id = v_step.id;
          v_queued := v_queued + 1;
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('enrolled', v_enrolled, 'queued', v_queued);
end;
$$;
revoke execute on function public.run_broadcast_sweep() from public, anon, authenticated;
grant execute on function public.run_broadcast_sweep() to service_role;
