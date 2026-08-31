-- P11e: admin can publish a platform-wide announcement (upcoming update,
-- new feature) that every signed-in user sees, in-app, until they dismiss
-- it. Deliberately NOT org_id-scoped -- CLAUDE.md rule 7 ("every table
-- carries org_id") exists to keep prospect PII from crossing tenants; an
-- admin broadcast is the opposite case by design (admin itself has no
-- org_id since p11c, and the whole point is every org sees the same
-- message), same reasoning as agents_admin_read/audit_admin_read (p6d)
-- already being cross-org for admin.
create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  message    text not null check (char_length(message) between 1 and 2000),
  created_by uuid not null references public.agents(id),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index announcements_active_idx on public.announcements (active, created_at desc);
alter table public.announcements enable row level security;

-- Every signed-in agent, any org, any role, sees active announcements; an
-- admin also sees inactive ones (to manage/reactivate past messages).
create policy announcements_select on public.announcements for select to authenticated
  using (active = true or (select private.my_role()) = 'admin');

-- Per-agent read receipt -- a dismissed announcement stays dismissed for
-- that agent across devices/sessions, the same "server-tracked, not
-- localStorage" choice the unsubscribe/notification_prefs flow already
-- makes. Own rows only, both directions.
create table public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  agent_id        uuid not null references public.agents(id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (announcement_id, agent_id)
);
alter table public.announcement_dismissals enable row level security;

create policy announcement_dismissals_own on public.announcement_dismissals for all to authenticated
  using (agent_id = (select auth.uid()))
  with check (agent_id = (select auth.uid()));

-- Writes go through service-role RPCs (same pattern as admin_move_agent /
-- admin_reactivate_agent / admin_hard_delete_agent / admin_delete_org,
-- p6a/p11d) so every publish/retract gets an audit_log row -- there is no
-- authenticated-role INSERT/UPDATE policy on public.announcements at all.
create or replace function public.admin_create_announcement(p_actor_id uuid, p_message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.announcements (message, created_by)
  values (p_message, p_actor_id)
  returning id into v_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
  values (p_actor_id, 'announcement.created', 'announcement', v_id::text,
          jsonb_build_object('message', p_message));
  return v_id;
end $$;
revoke all on function public.admin_create_announcement(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_create_announcement(uuid, text) to service_role;

create or replace function public.admin_set_announcement_active(
  p_actor_id uuid, p_announcement_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.announcements set active = p_active where id = p_announcement_id;
  if not found then raise exception 'announcement not found'; end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
  values (p_actor_id, case when p_active then 'announcement.reactivated' else 'announcement.retracted' end,
          'announcement', p_announcement_id::text, '{}'::jsonb);
end $$;
revoke all on function public.admin_set_announcement_active(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_announcement_active(uuid, uuid, boolean) to service_role;
