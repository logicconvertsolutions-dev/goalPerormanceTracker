-- P7d: /team/organization -- the SMD's own org name + logo. Previously the
-- only place organization rows were writable was admin-only creation
-- (provision_org); there was no update path for anyone, including the SMD
-- who owns that org day-to-day.

alter table public.organizations add column logo_path text;

-- A leader/admin may update their own org's name and logo only -- not
-- owner_id or call_log_retention_months (admin-only concerns, unchanged).
create policy organizations_update_own on public.organizations for update to authenticated
  using (
    id = (select private.my_org())
    and (select private.my_role()) in ('leader', 'admin')
  )
  with check (
    id = (select private.my_org())
    and (select private.my_role()) in ('leader', 'admin')
  );
revoke update on public.organizations from authenticated;
grant update (name, logo_path) on public.organizations to authenticated;

-- Logo storage: one object per org, path `{org_id}/logo.<ext>`. Private
-- bucket (not `public`) -- read is still RLS-scoped to the viewer's own org,
-- same as every other cross-tenant boundary in this app (CLAUDE.md rule 7),
-- even though a logo is low-sensitivity; served to the client via a signed
-- URL rather than a public one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-logos', 'org-logos', false, 2097152,
        array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy org_logos_select on storage.objects for select to authenticated using (
  bucket_id = 'org-logos'
  and (storage.foldername(name))[1] = (select private.my_org()::text)
);

create policy org_logos_write on storage.objects for insert to authenticated with check (
  bucket_id = 'org-logos'
  and (storage.foldername(name))[1] = (select private.my_org()::text)
  and (select private.my_role()) in ('leader', 'admin')
);

create policy org_logos_update on storage.objects for update to authenticated using (
  bucket_id = 'org-logos'
  and (storage.foldername(name))[1] = (select private.my_org()::text)
  and (select private.my_role()) in ('leader', 'admin')
);
