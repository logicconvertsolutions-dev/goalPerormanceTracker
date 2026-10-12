-- Set an organization's billing status by hand (P37; no billing system yet).
--
-- Run in the Supabase SQL editor (runs as postgres -- the only role, with
-- service_role, allowed to change these columns). Every change writes an
-- 'org.status_changed' row to audit_log automatically.
--
--   active     normal use
--   read_only  overdue: everyone can view + export, nobody can create/edit/delete
--   suspended  only the SMD can sign in, to export; associates are blocked
--
-- Users see the new status on their next page load.

-- 1. Find the org
select id, name, status, paid_through, status_note
from public.organizations
order by name;

-- 2. Set it (edit the three values and the id)
update public.organizations
   set status       = 'read_only',              -- 'active' | 'read_only' | 'suspended'
       paid_through = date '2026-10-31',        -- or null
       status_note  = 'Invoice #123 overdue'    -- free text, internal only
 where id = '00000000-0000-0000-0000-000000000000'
returning id, name, status, paid_through, status_note;

-- 3. Confirm + see the history
select created_at, metadata
from public.audit_log
where action = 'org.status_changed'
  and entity_id = '00000000-0000-0000-0000-000000000000'
order by created_at desc;
