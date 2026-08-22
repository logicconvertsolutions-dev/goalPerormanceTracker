-- p5a added targets_audit_insert/audit_target_insert, duplicating the
-- audit_target_change/targets_audit trigger already shipped in
-- p1j_invite_only_signup.sql (action = 'insert.target'/'update.target').
-- Drop the redundant one -- every targets write already lands in audit_log.
drop trigger if exists targets_audit_insert on public.targets;
drop function if exists public.audit_target_insert();
