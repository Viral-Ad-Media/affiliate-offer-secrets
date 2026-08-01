-- GDPR/CCPA erasure. contacts is the first table in this app holding a THIRD PARTY's PII (a
-- tenant's own visitor), and until now there was no way to remove one — the honest gap in it.
--
-- Two functions because a real erasure request and a tidy-up are different actions:
--   delete_contact(id)        — "remove this row", the everyday case.
--   erase_contact_email(email) — "erase this person", which must cover every row for that address
--                                across every campaign, AND the copies of their address sitting in
--                                the send logs. Deleting the contact row alone would leave their
--                                email in mail_sends/broadcast_sends.to_address, which is exactly
--                                the kind of leftover that makes an erasure claim untrue.
--
-- Send rows are REDACTED, not deleted: that an email was sent is a legitimate audit record (and
-- the pooled rate cap counts it); the address is the personal data. '.invalid' is the reserved TLD
-- from RFC 2606, so a redacted value can never collide with a real address.
--
-- SECURITY DEFINER + auth.uid() scoping, granted to authenticated: contacts deliberately has no
-- client write policy, so this is the narrow, self-scoped hole — the same shape as start_trial()
-- and update_profile(). A caller can only ever erase their own contacts.

create or replace function public.delete_contact(p_contact_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.contacts
  where id = p_contact_id and user_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

create or replace function public.erase_contact_email(p_email text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_contacts int;
  v_sends int;
  v_broadcasts int;
begin
  if v_email = '' or v_email is null then
    raise exception 'An email address is required';
  end if;

  delete from public.contacts
  where user_id = auth.uid() and lower(email) = v_email;
  get diagnostics v_contacts = row_count;

  update public.mail_sends
  set to_address = 'erased@redacted.invalid'
  where user_id = auth.uid() and lower(to_address) = v_email;
  get diagnostics v_sends = row_count;

  update public.broadcast_sends
  set to_address = 'erased@redacted.invalid'
  where user_id = auth.uid() and lower(to_address) = v_email;
  get diagnostics v_broadcasts = row_count;

  -- Reported back so the tenant can answer the requester precisely, and so "0 everywhere" reads as
  -- "we hold nothing for this address" rather than looking like a silent failure.
  return jsonb_build_object(
    'contacts_deleted', v_contacts,
    'mail_sends_redacted', v_sends,
    'broadcast_sends_redacted', v_broadcasts
  );
end;
$$;

revoke execute on function public.delete_contact(uuid) from public, anon;
revoke execute on function public.erase_contact_email(text) from public, anon;
grant execute on function public.delete_contact(uuid) to authenticated;
grant execute on function public.erase_contact_email(text) to authenticated;

-- erase_contact_email scans by address, which nothing indexed before.
create index if not exists contacts_user_email_lower_idx on public.contacts (user_id, lower(email));
create index if not exists mail_sends_user_to_lower_idx on public.mail_sends (user_id, lower(to_address));
create index if not exists broadcast_sends_user_to_lower_idx on public.broadcast_sends (user_id, lower(to_address));
