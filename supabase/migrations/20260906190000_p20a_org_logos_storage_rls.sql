-- P20a: RLS policies for the org-logos storage bucket.
--
-- The bucket itself is declared in supabase/config.toml, but bucket
-- declarations don't create storage.objects RLS policies -- those are
-- separate rows/policies in the `storage` schema, which `pg_dump` of
-- public+private never captures (see "Known gotchas" in CLAUDE.md re: the
-- baseline dump missing storage-owned objects). Production had working
-- policies from manual setup that predates any tracked migration; a fresh
-- environment (staging, or `supabase db reset` locally) has the bucket but
-- no policies, so uploadOrgLogoAction fails with "new row violates row-
-- level security policy" the moment an SMD tries to upload a logo.
--
-- Mirrors organizations_update_own's role/org check (private.my_role() in
-- leader/admin, scoped to private.my_org()) and uploadOrgLogoAction's own
-- `${org_id}/logo.<ext>` path convention -- the first path segment is the
-- org id.

drop policy if exists "org_logos_leader_write" on storage.objects;
create policy "org_logos_leader_write"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'org-logos'
    and private.my_role() = any (array['leader', 'admin']::public.agent_role[])
    and (storage.foldername(name))[1] = (private.my_org())::text
  );

drop policy if exists "org_logos_leader_update" on storage.objects;
create policy "org_logos_leader_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'org-logos'
    and private.my_role() = any (array['leader', 'admin']::public.agent_role[])
    and (storage.foldername(name))[1] = (private.my_org())::text
  )
  with check (
    bucket_id = 'org-logos'
    and private.my_role() = any (array['leader', 'admin']::public.agent_role[])
    and (storage.foldername(name))[1] = (private.my_org())::text
  );

drop policy if exists "org_logos_leader_delete" on storage.objects;
create policy "org_logos_leader_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'org-logos'
    and private.my_role() = any (array['leader', 'admin']::public.agent_role[])
    and (storage.foldername(name))[1] = (private.my_org())::text
  );

-- Every role in the org (not just leader/admin) needs to read the logo --
-- the app header (src/app/(app)/layout.tsx) signs it for every associate.
drop policy if exists "org_logos_org_read" on storage.objects;
create policy "org_logos_org_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = (private.my_org())::text
  );
