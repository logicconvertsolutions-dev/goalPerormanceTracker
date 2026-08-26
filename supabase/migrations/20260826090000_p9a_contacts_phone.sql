-- Adds phone capture to contacts (previously deliberately omitted — see
-- 20260818132521_p1b_core_tables.sql's comment — reversed by explicit product
-- decision: agents need phone numbers on contacts, and phone-based dedup
-- during Excel import/manual logging). `phone_normalized` is a generated,
-- digits-only column so matching is index-backed and immune to formatting
-- differences ("(555) 123-4567" vs "555-123-4567"); `contacts_own`'s existing
-- blanket RLS policy already covers the new column, no policy change needed.
alter table public.contacts add column phone text;
alter table public.contacts add column phone_normalized text
  generated always as (nullif(regexp_replace(phone, '\D', '', 'g'), '')) stored;

create unique index contacts_agent_phone_uq
  on public.contacts (agent_id, phone_normalized)
  where phone_normalized is not null;
