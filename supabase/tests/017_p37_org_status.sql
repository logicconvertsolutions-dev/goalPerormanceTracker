-- pgTAP suite for P37 (org status: active / read_only / suspended).
-- Generated as a status matrix: every check runs once per status of org A,
-- with org B kept 'active' as the control.
--
--   org A (e1): smd_a (a1) -> assoc_a (a2)     org B (e2): assoc_b (b2)
--   platform admin (d1), org-less
--
-- Writes that RLS refuses on INSERT raise 42501; refused UPDATE/DELETE
-- match 0 rows (RLS filters, it doesn't raise), so those are counted.
-- Definer-RPC guards raise 42501 (private.assert_org_*).

begin;
create extension if not exists pgtap with schema extensions;

select plan(84);

insert into public.organizations (id, name) values ('00000000-0000-0000-0000-0000000037e1', 'p37_org_a'), ('00000000-0000-0000-0000-0000000037e2', 'p37_org_b');
insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('p37_smd_a@example.com',   '00000000-0000-0000-0000-0000000037e1', null, 'leader',    'p37-tok-1', null),
  ('p37_assoc_a@example.com', '00000000-0000-0000-0000-0000000037e1', null, 'associate', 'p37-tok-2', null),
  ('p37_assoc_b@example.com', '00000000-0000-0000-0000-0000000037e2', null, 'associate', 'p37-tok-3', null),
  ('p37_admin@example.com',   null,   null, 'admin',     'p37-tok-4', null);
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000037a1', 'p37_smd_a@example.com',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000037a2',  'p37_assoc_a@example.com', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000037b2', 'p37_assoc_b@example.com', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000037d1', 'p37_admin@example.com',   '{}', 'authenticated', 'authenticated');
update public.agents set upline_id = '00000000-0000-0000-0000-0000000037a1' where id = '00000000-0000-0000-0000-0000000037a2';
insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000037c1', '00000000-0000-0000-0000-0000000037a2',  'Prospect A'),
  ('00000000-0000-0000-0000-0000000037c5', '00000000-0000-0000-0000-0000000037a1', 'Prospect of SMD'),
  ('00000000-0000-0000-0000-0000000037c9', '00000000-0000-0000-0000-0000000037b2', 'Prospect B');

-- =====================================================================
-- active
-- =====================================================================
reset role;
update public.organizations set status = 'active' where id = '00000000-0000-0000-0000-0000000037e1';
insert into public.contacts (id, agent_id, full_name) values ('00000000-0000-0000-0000-0000000037d0', '00000000-0000-0000-0000-0000000037a2', 'Disposable active');
insert into public.reminders (id, org_id, agent_id, title, remind_at) values ('00000000-0000-0000-0000-0000000037f0', '00000000-0000-0000-0000-0000000037e1', '00000000-0000-0000-0000-0000000037a2', 'Ping active', now());
-- associate, own org
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037a2","role":"authenticated"}', true);
select lives_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037a2', 'New active')$$, '[active] associate INSERT contact allowed');
select lives_ok($$insert into public.call_logs (agent_id, contact_id, source, outcome) values ('00000000-0000-0000-0000-0000000037a2', '00000000-0000-0000-0000-0000000037c1', 'cold', 'voicemail')$$, '[active] associate INSERT call_log allowed');
select lives_ok($$insert into public.tasks (title, due_on) values ('Task active', current_date)$$, '[active] associate INSERT task allowed');
with u as (update public.contacts set notes = 'active' where id = '00000000-0000-0000-0000-0000000037c1' returning 1) select is(count(*)::int, 1, '[active] associate UPDATE contact allowed') from u;
with u as (delete from public.contacts where id = '00000000-0000-0000-0000-0000000037d0' returning 1) select is(count(*)::int, 1, '[active] associate DELETE contact allowed') from u;
select ok((select count(*) from public.contacts where id = '00000000-0000-0000-0000-0000000037c1') = 1, '[active] associate SELECT own contacts allowed');
select lives_ok($$select * from public.my_followups(current_date)$$, '[active] associate my_followups RPC allowed');
select is((select status from public.organizations where id = '00000000-0000-0000-0000-0000000037e1'), 'active', '[active] associate can always read own org status (for banner/blocked screen)');
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000037a2'), 1, '[active] associate can always read own agents row (session load)');
-- associate, cross-org (org B stays active)
select is((select count(*)::int from public.contacts where id = '00000000-0000-0000-0000-0000000037c9'), 0, '[active] associate cannot see org B contact');
with u as (update public.contacts set notes = 'x' where id = '00000000-0000-0000-0000-0000000037c9' returning 1) select is(count(*)::int, 0, '[active] associate cannot update org B contact') from u;
with u as (delete from public.contacts where id = '00000000-0000-0000-0000-0000000037c9' returning 1) select is(count(*)::int, 0, '[active] associate cannot delete org B contact') from u;
select throws_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037b2', 'Planted')$$, '42501', null, '[active] associate cannot insert into org B');
-- SMD
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037a1","role":"authenticated"}', true);
select lives_ok($$select public.set_target('00000000-0000-0000-0000-0000000037a2', current_date + 10, 50, 3, 18800, 15)$$, '[active] SMD set_target RPC allowed');
select lives_ok($$select public.create_invitation('p37_inv_0@example.com', 'associate')$$, '[active] SMD create_invitation RPC allowed');
select lives_ok($$insert into public.team_roster (org_id, upline_id, full_name, created_by) values ('00000000-0000-0000-0000-0000000037e1', '00000000-0000-0000-0000-0000000037a1', 'Roster active', '00000000-0000-0000-0000-0000000037a1')$$, '[active] SMD INSERT team_roster allowed');
with u as (update public.organizations set name = 'Org A active' where id = '00000000-0000-0000-0000-0000000037e1' returning 1) select is(count(*)::int, 1, '[active] SMD UPDATE org name allowed') from u;
select throws_ok($$update public.organizations set status = 'active', paid_through = '2099-01-01' where id = '00000000-0000-0000-0000-0000000037e1'$$, '42501', null, '[active] SMD can never change own org status/paid_through');
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000037a2'), 1, '[active] SMD SELECT downline agents row allowed');
select lives_ok($$select * from public.team_period_summary(current_date - 10, current_date)$$, '[active] SMD team_period_summary RPC allowed (export)');
select is((select count(*)::int from public.contacts where id = '00000000-0000-0000-0000-0000000037c5'), 1, '[active] SMD SELECT own contacts allowed (export)');
select lives_ok($$insert into storage.objects (bucket_id, name, owner) values ('org-logos', '00000000-0000-0000-0000-0000000037e1/logo-active.png', '00000000-0000-0000-0000-0000000037a1')$$, '[active] SMD upload org-logos allowed');
-- org B associate: unaffected
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037b2","role":"authenticated"}', true);
select lives_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037b2', 'B active')$$, '[active] org B (active) associate INSERT unaffected');
-- platform admin / service role / system paths
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037d1","role":"authenticated"}', true);
select is((select count(*)::int from public.organizations where id = '00000000-0000-0000-0000-0000000037e1'), 1, '[active] platform admin reads org A');
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000037a2'), 1, '[active] platform admin reads org A agents (bypass)');
reset role;
set local role service_role;
select lives_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037a2', 'Svc active')$$, '[active] service_role bypasses RLS');
reset role;
select private.enqueue_due_pushes();
select is((select count(*)::int from public.notifications where source_key = 'reminder:00000000-0000-0000-0000-0000000037f0'), 1, '[active] cron reminder push sent');
insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values ('p37_join_0@example.com', '00000000-0000-0000-0000-0000000037e1', '00000000-0000-0000-0000-0000000037a1', 'associate', 'p37-join-0', null);
select lives_ok($$insert into auth.users (id, email, raw_user_meta_data, aud, role) values ('00000000-0000-0000-0000-000000003770', 'p37_join_0@example.com', '{}', 'authenticated', 'authenticated')$$, '[active] accepting an invite into org A allowed');

-- =====================================================================
-- read_only
-- =====================================================================
reset role;
update public.organizations set status = 'read_only' where id = '00000000-0000-0000-0000-0000000037e1';
insert into public.contacts (id, agent_id, full_name) values ('00000000-0000-0000-0000-0000000037d1', '00000000-0000-0000-0000-0000000037a2', 'Disposable read_only');
insert into public.reminders (id, org_id, agent_id, title, remind_at) values ('00000000-0000-0000-0000-0000000037f1', '00000000-0000-0000-0000-0000000037e1', '00000000-0000-0000-0000-0000000037a2', 'Ping read_only', now());
-- associate, own org
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037a2","role":"authenticated"}', true);
select throws_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037a2', 'New read_only')$$, '42501', null, '[read_only] associate INSERT contact blocked');
select throws_ok($$insert into public.call_logs (agent_id, contact_id, source, outcome) values ('00000000-0000-0000-0000-0000000037a2', '00000000-0000-0000-0000-0000000037c1', 'cold', 'voicemail')$$, '42501', null, '[read_only] associate INSERT call_log blocked');
select throws_ok($$insert into public.tasks (title, due_on) values ('Task read_only', current_date)$$, '42501', null, '[read_only] associate INSERT task blocked');
with u as (update public.contacts set notes = 'read_only' where id = '00000000-0000-0000-0000-0000000037c1' returning 1) select is(count(*)::int, 0, '[read_only] associate UPDATE contact blocked (0 rows)') from u;
with u as (delete from public.contacts where id = '00000000-0000-0000-0000-0000000037d1' returning 1) select is(count(*)::int, 0, '[read_only] associate DELETE contact blocked (0 rows)') from u;
select ok((select count(*) from public.contacts where id = '00000000-0000-0000-0000-0000000037c1') = 1, '[read_only] associate SELECT own contacts allowed');
select lives_ok($$select * from public.my_followups(current_date)$$, '[read_only] associate my_followups RPC allowed');
select is((select status from public.organizations where id = '00000000-0000-0000-0000-0000000037e1'), 'read_only', '[read_only] associate can always read own org status (for banner/blocked screen)');
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000037a2'), 1, '[read_only] associate can always read own agents row (session load)');
-- associate, cross-org (org B stays active)
select is((select count(*)::int from public.contacts where id = '00000000-0000-0000-0000-0000000037c9'), 0, '[read_only] associate cannot see org B contact');
with u as (update public.contacts set notes = 'x' where id = '00000000-0000-0000-0000-0000000037c9' returning 1) select is(count(*)::int, 0, '[read_only] associate cannot update org B contact') from u;
with u as (delete from public.contacts where id = '00000000-0000-0000-0000-0000000037c9' returning 1) select is(count(*)::int, 0, '[read_only] associate cannot delete org B contact') from u;
select throws_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037b2', 'Planted')$$, '42501', null, '[read_only] associate cannot insert into org B');
-- SMD
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037a1","role":"authenticated"}', true);
select throws_ok($$select public.set_target('00000000-0000-0000-0000-0000000037a2', current_date + 11, 50, 3, 18800, 15)$$, '42501', null, '[read_only] SMD set_target RPC blocked');
select throws_ok($$select public.create_invitation('p37_inv_1@example.com', 'associate')$$, '42501', null, '[read_only] SMD create_invitation RPC blocked');
select throws_ok($$insert into public.team_roster (org_id, upline_id, full_name, created_by) values ('00000000-0000-0000-0000-0000000037e1', '00000000-0000-0000-0000-0000000037a1', 'Roster read_only', '00000000-0000-0000-0000-0000000037a1')$$, '42501', null, '[read_only] SMD INSERT team_roster blocked');
with u as (update public.organizations set name = 'Org A read_only' where id = '00000000-0000-0000-0000-0000000037e1' returning 1) select is(count(*)::int, 0, '[read_only] SMD UPDATE org name blocked (0 rows)') from u;
select throws_ok($$update public.organizations set status = 'active', paid_through = '2099-01-01' where id = '00000000-0000-0000-0000-0000000037e1'$$, '42501', null, '[read_only] SMD can never change own org status/paid_through');
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000037a2'), 1, '[read_only] SMD SELECT downline agents row allowed');
select lives_ok($$select * from public.team_period_summary(current_date - 10, current_date)$$, '[read_only] SMD team_period_summary RPC allowed (export)');
select is((select count(*)::int from public.contacts where id = '00000000-0000-0000-0000-0000000037c5'), 1, '[read_only] SMD SELECT own contacts allowed (export)');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('org-logos', '00000000-0000-0000-0000-0000000037e1/logo-read_only.png', '00000000-0000-0000-0000-0000000037a1')$$, '42501', null, '[read_only] SMD upload org-logos blocked');
-- org B associate: unaffected
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037b2","role":"authenticated"}', true);
select lives_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037b2', 'B read_only')$$, '[read_only] org B (active) associate INSERT unaffected');
-- platform admin / service role / system paths
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037d1","role":"authenticated"}', true);
select is((select count(*)::int from public.organizations where id = '00000000-0000-0000-0000-0000000037e1'), 1, '[read_only] platform admin reads org A');
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000037a2'), 1, '[read_only] platform admin reads org A agents (bypass)');
reset role;
set local role service_role;
select lives_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037a2', 'Svc read_only')$$, '[read_only] service_role bypasses RLS');
reset role;
select private.enqueue_due_pushes();
select is((select count(*)::int from public.notifications where source_key = 'reminder:00000000-0000-0000-0000-0000000037f1'), 0, '[read_only] cron reminder push suppressed');
insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values ('p37_join_1@example.com', '00000000-0000-0000-0000-0000000037e1', '00000000-0000-0000-0000-0000000037a1', 'associate', 'p37-join-1', null);
select throws_ok($$insert into auth.users (id, email, raw_user_meta_data, aud, role) values ('00000000-0000-0000-0000-000000003771', 'p37_join_1@example.com', '{}', 'authenticated', 'authenticated')$$, '42501', null, '[read_only] accepting an invite into org A blocked');

-- =====================================================================
-- suspended
-- =====================================================================
reset role;
update public.organizations set status = 'suspended' where id = '00000000-0000-0000-0000-0000000037e1';
insert into public.contacts (id, agent_id, full_name) values ('00000000-0000-0000-0000-0000000037d2', '00000000-0000-0000-0000-0000000037a2', 'Disposable suspended');
insert into public.reminders (id, org_id, agent_id, title, remind_at) values ('00000000-0000-0000-0000-0000000037f2', '00000000-0000-0000-0000-0000000037e1', '00000000-0000-0000-0000-0000000037a2', 'Ping suspended', now());
-- associate, own org
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037a2","role":"authenticated"}', true);
select throws_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037a2', 'New suspended')$$, '42501', null, '[suspended] associate INSERT contact blocked');
select throws_ok($$insert into public.call_logs (agent_id, contact_id, source, outcome) values ('00000000-0000-0000-0000-0000000037a2', '00000000-0000-0000-0000-0000000037c1', 'cold', 'voicemail')$$, '42501', null, '[suspended] associate INSERT call_log blocked');
select throws_ok($$insert into public.tasks (title, due_on) values ('Task suspended', current_date)$$, '42501', null, '[suspended] associate INSERT task blocked');
with u as (update public.contacts set notes = 'suspended' where id = '00000000-0000-0000-0000-0000000037c1' returning 1) select is(count(*)::int, 0, '[suspended] associate UPDATE contact blocked (0 rows)') from u;
with u as (delete from public.contacts where id = '00000000-0000-0000-0000-0000000037d2' returning 1) select is(count(*)::int, 0, '[suspended] associate DELETE contact blocked (0 rows)') from u;
select ok((select count(*) from public.contacts where id = '00000000-0000-0000-0000-0000000037c1') = 0, '[suspended] associate SELECT own contacts blocked');
select throws_ok($$select * from public.my_followups(current_date)$$, '42501', null, '[suspended] associate my_followups RPC blocked');
select is((select status from public.organizations where id = '00000000-0000-0000-0000-0000000037e1'), 'suspended', '[suspended] associate can always read own org status (for banner/blocked screen)');
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000037a2'), 1, '[suspended] associate can always read own agents row (session load)');
-- associate, cross-org (org B stays active)
select is((select count(*)::int from public.contacts where id = '00000000-0000-0000-0000-0000000037c9'), 0, '[suspended] associate cannot see org B contact');
with u as (update public.contacts set notes = 'x' where id = '00000000-0000-0000-0000-0000000037c9' returning 1) select is(count(*)::int, 0, '[suspended] associate cannot update org B contact') from u;
with u as (delete from public.contacts where id = '00000000-0000-0000-0000-0000000037c9' returning 1) select is(count(*)::int, 0, '[suspended] associate cannot delete org B contact') from u;
select throws_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037b2', 'Planted')$$, '42501', null, '[suspended] associate cannot insert into org B');
-- SMD
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037a1","role":"authenticated"}', true);
select throws_ok($$select public.set_target('00000000-0000-0000-0000-0000000037a2', current_date + 12, 50, 3, 18800, 15)$$, '42501', null, '[suspended] SMD set_target RPC blocked');
select throws_ok($$select public.create_invitation('p37_inv_2@example.com', 'associate')$$, '42501', null, '[suspended] SMD create_invitation RPC blocked');
select throws_ok($$insert into public.team_roster (org_id, upline_id, full_name, created_by) values ('00000000-0000-0000-0000-0000000037e1', '00000000-0000-0000-0000-0000000037a1', 'Roster suspended', '00000000-0000-0000-0000-0000000037a1')$$, '42501', null, '[suspended] SMD INSERT team_roster blocked');
with u as (update public.organizations set name = 'Org A suspended' where id = '00000000-0000-0000-0000-0000000037e1' returning 1) select is(count(*)::int, 0, '[suspended] SMD UPDATE org name blocked (0 rows)') from u;
select throws_ok($$update public.organizations set status = 'active', paid_through = '2099-01-01' where id = '00000000-0000-0000-0000-0000000037e1'$$, '42501', null, '[suspended] SMD can never change own org status/paid_through');
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000037a2'), 1, '[suspended] SMD SELECT downline agents row allowed');
select lives_ok($$select * from public.team_period_summary(current_date - 10, current_date)$$, '[suspended] SMD team_period_summary RPC allowed (export)');
select is((select count(*)::int from public.contacts where id = '00000000-0000-0000-0000-0000000037c5'), 1, '[suspended] SMD SELECT own contacts allowed (export)');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('org-logos', '00000000-0000-0000-0000-0000000037e1/logo-suspended.png', '00000000-0000-0000-0000-0000000037a1')$$, '42501', null, '[suspended] SMD upload org-logos blocked');
-- org B associate: unaffected
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037b2","role":"authenticated"}', true);
select lives_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037b2', 'B suspended')$$, '[suspended] org B (active) associate INSERT unaffected');
-- platform admin / service role / system paths
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037d1","role":"authenticated"}', true);
select is((select count(*)::int from public.organizations where id = '00000000-0000-0000-0000-0000000037e1'), 1, '[suspended] platform admin reads org A');
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000037a2'), 1, '[suspended] platform admin reads org A agents (bypass)');
reset role;
set local role service_role;
select lives_ok($$insert into public.contacts (agent_id, full_name) values ('00000000-0000-0000-0000-0000000037a2', 'Svc suspended')$$, '[suspended] service_role bypasses RLS');
reset role;
select private.enqueue_due_pushes();
select is((select count(*)::int from public.notifications where source_key = 'reminder:00000000-0000-0000-0000-0000000037f2'), 0, '[suspended] cron reminder push suppressed');
insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values ('p37_join_2@example.com', '00000000-0000-0000-0000-0000000037e1', '00000000-0000-0000-0000-0000000037a1', 'associate', 'p37-join-2', null);
select throws_ok($$insert into auth.users (id, email, raw_user_meta_data, aud, role) values ('00000000-0000-0000-0000-000000003772', 'p37_join_2@example.com', '{}', 'authenticated', 'authenticated')$$, '42501', null, '[suspended] accepting an invite into org A blocked');
-- ---------------------------------------------------------------------
-- Flip audit: every status change above left an audit row.
-- ---------------------------------------------------------------------
reset role;
select * from finish();
rollback;
