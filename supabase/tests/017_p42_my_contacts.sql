-- pgTAP suite for P42 (20261019100000_p42_contacts_paging_and_indexes.sql):
-- the Contacts screen's paged read, public.my_contacts().
--
-- What must hold:
--   * the agent gets their own contacts only, sorted by name
--     case-insensitively, with the total match count
--   * the per-contact summary: times called, last call + outcome (latest
--     call_date wins), next *open* follow-up
--   * paging: limit/offset pages don't overlap, and a page past the end is
--     empty
--   * search matches name or notes, case-insensitively; LIKE wildcards in
--     the search are literal
--   * the upline SMD, another org's associate and anon get nothing (rules 1,
--     2 and 8); the function is SECURITY INVOKER, so RLS stays the boundary
--   * the new indexes exist

begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000042e1', 'p42_org_x'),
  ('00000000-0000-0000-0000-0000000042e2', 'p42_org_y');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('p42_smd_x@example.com',   '00000000-0000-0000-0000-0000000042e1', null, 'leader',    'p42-tok-1', null),
  ('p42_assoc_x@example.com', '00000000-0000-0000-0000-0000000042e1', null, 'associate', 'p42-tok-2', null),
  ('p42_assoc_y@example.com', '00000000-0000-0000-0000-0000000042e2', null, 'associate', 'p42-tok-3', null);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000042a1', 'p42_smd_x@example.com',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000042a2', 'p42_assoc_x@example.com', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000042b2', 'p42_assoc_y@example.com', '{}', 'authenticated', 'authenticated');

update public.agents set full_name = 'Smd X' where id = '00000000-0000-0000-0000-0000000042a1';
update public.agents set full_name = 'Assoc X', upline_id = '00000000-0000-0000-0000-0000000042a1'
  where id = '00000000-0000-0000-0000-0000000042a2';
update public.agents set full_name = 'Assoc Y' where id = '00000000-0000-0000-0000-0000000042b2';

-- Mixed case on purpose: the sort is case-insensitive (bob < Carol < dave).
insert into public.contacts (id, agent_id, full_name, notes) values
  ('00000000-0000-0000-0000-0000000042c1', '00000000-0000-0000-0000-0000000042a2', 'Carol', 'met at the gym'),
  ('00000000-0000-0000-0000-0000000042c2', '00000000-0000-0000-0000-0000000042a2', 'bob',   'wants 50% off'),
  ('00000000-0000-0000-0000-0000000042c3', '00000000-0000-0000-0000-0000000042a2', 'dave',  null),
  ('00000000-0000-0000-0000-0000000042c9', '00000000-0000-0000-0000-0000000042b2', 'Carol of Y', null);

-- bob: three calls. The latest call_date wins for "last call"; of the two
-- follow-ups, the done one is ignored.
insert into public.call_logs (agent_id, contact_id, call_date, source, outcome, follow_up_on, follow_up_done_at) values
  ('00000000-0000-0000-0000-0000000042a2', '00000000-0000-0000-0000-0000000042c2', current_date - 5, 'warm_market', 'no_answer', current_date - 4, now()),
  ('00000000-0000-0000-0000-0000000042a2', '00000000-0000-0000-0000-0000000042c2', current_date - 1, 'warm_market', 'connected', current_date + 3, null),
  ('00000000-0000-0000-0000-0000000042a2', '00000000-0000-0000-0000-0000000042c2', current_date - 3, 'warm_market', 'voicemail', null, null);

-- ---------------------------------------------------------------------
-- Owner
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000042a2","role":"authenticated"}', true);

select results_eq(
  $$ select full_name from public.my_contacts() $$,
  $$ values ('bob'::text), ('Carol'), ('dave') $$,
  'own contacts only, sorted by name case-insensitively'
);
select is((select distinct total_count from public.my_contacts()), 3::bigint, 'total_count counts every match');

select is((select times_called from public.my_contacts() where full_name = 'bob'), 3, 'times_called');
select is((select last_call_date from public.my_contacts() where full_name = 'bob'), current_date - 1, 'last call is the latest call_date');
select is((select last_outcome::text from public.my_contacts() where full_name = 'bob'), 'connected', 'last outcome is that call''s');
select is((select next_follow_up from public.my_contacts() where full_name = 'bob'), current_date + 3, 'next follow-up skips done ones');
select is((select times_called from public.my_contacts() where full_name = 'dave'), 0, 'a contact with no calls has 0');
select ok((select last_call_date is null and next_follow_up is null from public.my_contacts() where full_name = 'dave'),
  'and no last call or follow-up');

-- Paging
select results_eq(
  $$ select full_name from public.my_contacts(null, 2, 0) $$,
  $$ values ('bob'::text), ('Carol') $$,
  'first page'
);
select results_eq(
  $$ select full_name from public.my_contacts(null, 2, 2) $$,
  $$ values ('dave'::text) $$,
  'second page continues where the first stopped'
);
select is((select count(*) from public.my_contacts(null, 2, 10)), 0::bigint, 'a page past the end is empty');

-- Search
select results_eq(
  $$ select full_name from public.my_contacts('CAR') $$,
  $$ values ('Carol'::text) $$,
  'search matches the name case-insensitively'
);
select results_eq(
  $$ select full_name from public.my_contacts('gym') $$,
  $$ values ('Carol'::text) $$,
  'search matches the notes'
);
select results_eq(
  $$ select full_name from public.my_contacts('50%') $$,
  $$ values ('bob'::text) $$,
  'a % in the search is literal'
);
select is((select count(*) from public.my_contacts('a_e')), 0::bigint, 'an _ in the search is literal (no match for "dave")');

-- ---------------------------------------------------------------------
-- Upline SMD, another org, anon
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000042a1","role":"authenticated"}', true);
select is((select count(*) from public.my_contacts()), 0::bigint, 'the upline SMD gets none of the associate''s contacts');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000042b2","role":"authenticated"}', true);
select results_eq(
  $$ select full_name from public.my_contacts() $$,
  $$ values ('Carol of Y'::text) $$,
  'an associate in another org gets only their own'
);

reset role;
set local role anon;
select throws_ok($$ select * from public.my_contacts() $$);
reset role;

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'my_contacts'),
  false,
  'my_contacts is SECURITY INVOKER (RLS stays the boundary)'
);

select has_index('public', 'contacts', 'contacts_full_name_trgm_idx', 'trigram index for name search');
select has_index('public', 'call_logs', 'call_logs_contact_idx', 'call_logs.contact_id is indexed');

select * from finish();
rollback;
