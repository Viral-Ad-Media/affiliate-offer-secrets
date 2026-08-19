-- last_name becomes a first-class contact column, promoted out of extra_fields the same way
-- phone was in 0097. The "Last name" form preset always wrote fieldKey last_name, so every lead
-- who filled one landed in the Extra column beside genuinely custom fields — a person's name is
-- not an extra. Display composes full name = first + last; exports carry the columns separately
-- (ESPs map them separately).
alter table public.contacts add column if not exists last_name text;

-- Backfill: move the value into the column and strip the key, so the Extra column stops showing
-- it for existing leads too. Trimmed and capped like every name this app stores; the promotion is
-- skipped (value left in place) only when the stored value isn't a string, which cannot happen
-- through the leads route but could through a hand-written row.
update public.contacts
   set last_name = nullif(btrim(left(extra_fields ->> 'last_name', 80)), ''),
       extra_fields = extra_fields - 'last_name'
 where extra_fields ? 'last_name';
