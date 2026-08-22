-- P6: /admin/agents needs to see agents across every org, and /admin/orgs's
-- "Existing" list needs to see every org -- neither table had an
-- admin-wide read policy, only the my_org()/is_upline_of ones from p1h.
-- Pre-existing gap, not introduced here: /admin/orgs's org list has
-- presumably always been silently scoped to just the admin's own org.
--
-- Safe to add: both policies expose only name/email/role/status-level
-- operational data, the same non-PII shape agents_select already allows
-- within a downline (CLAUDE.md rule 2 is about prospect PII specifically,
-- never agents/organizations metadata).
create policy agents_admin_read on public.agents for select to authenticated
  using ( (select private.my_role()) = 'admin' );

create policy organizations_admin_read on public.organizations for select to authenticated
  using ( (select private.my_role()) = 'admin' );
