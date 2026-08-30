-- P10a: capture explicit Terms & Conditions agreement.
--
-- The accept-invite checkbox ("I accept the privacy notice...") previously
-- only gated the client-side submit button -- nothing was ever recorded in
-- the database, so there was no actual record of anyone agreeing to
-- anything. This column is that record; acceptInvitation() sets it via the
-- admin client at signup, and existing agents who joined before this column
-- existed are sent through a one-time /terms/accept gate (see
-- requireVerifiedAgent in src/lib/auth/guards.ts) that sets it themselves.
alter table public.agents add column terms_accepted_at timestamptz;

-- Self-service acceptance for the one-time gate above. Additive to the
-- existing `grant update (full_name)` from p1h -- agents_update_self's RLS
-- policy (id = auth.uid()) already scopes this to the caller's own row, and
-- guard_agent_privileged_columns only ever guards role/upline_id/org_id/status,
-- so this column needs no extra guarding.
grant update (terms_accepted_at) on public.agents to authenticated;
