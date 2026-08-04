-- broadcast_sends.enrollment_step_id: on delete cascade -> on delete set null.
--
-- 0021 gave this FK a cascade ("dependent record, matches ad_launches.campaign_id's cascade
-- precedent"), but that was the wrong precedent for an audit-trail table: deleting a broadcast
-- sequence cascades sequence -> enrollments -> enrollment_steps -> broadcast_sends, erasing the
-- send-history rows that sequence_id/step_id/contact_id were deliberately made `on delete set
-- null` to preserve. It also undercounts the pooled 24h send cap, which counts these rows
-- (is_capped_mail_sender in 0027 and the stage-time count in lib/engine/broadcast.ts).
--
-- The column was created nullable in 0021, so only the FK action changes. Safe for existing
-- readers: nothing selects broadcast_sends by enrollment_step_id — every call site filtering on
-- that value targets broadcast_enrollment_steps.id or jobs.payload.

alter table public.broadcast_sends
  drop constraint broadcast_sends_enrollment_step_id_fkey,
  add constraint broadcast_sends_enrollment_step_id_fkey
    foreign key (enrollment_step_id) references public.broadcast_enrollment_steps(id)
    on delete set null;
