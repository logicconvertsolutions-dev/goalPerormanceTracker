-- P21a: let an Admin open an individual organization from /admin/orgs and
-- add a new team member to it, the same way an SMD builds their roster from
-- /team/members.
--
-- Gap: team_roster's RLS (team_roster_insert/read/delete/update) already
-- lists 'admin' alongside 'leader' in its role check, but every policy also
-- requires org_id = private.my_org() -- and an admin's own agents.org_id is
-- always null (they aren't part of any organization, see requireLeader()'s
-- comment in src/lib/auth/guards.ts). So an admin could never satisfy that
-- clause for *any* org's roster row, despite the policy text suggesting
-- otherwise. Same story for is_upline_of(upline_id): admin has no place in
-- agent_closure for an org they don't belong to.
--
-- Fix, mirroring the existing admin cross-org pattern (organizations_admin_read
-- / agents_admin_read for reads, admin_move_agent/admin_set_agent_role/etc.
-- for writes, all in 20260819100000's admin agent lifecycle work folded into
-- baseline.sql):
--   1. A read-only team_roster_admin_read policy, so an admin's regular
--      (RLS-bound) client can list any org's pending roster -- team_roster
--      holds prospective-associate name/email/phone, not client/prospect
--      PII, so this is the same category of data agents_admin_read already
--      exposes for hired agents, just pre-hire.
--   2. Three SECURITY DEFINER RPCs, granted to service_role only (never
--      authenticated/anon) and called from the server through
--      createAdminClient(), same as admin_move_agent etc. They take
--      p_actor_id explicitly rather than reading auth.uid() -- the
--      service-role client carries no user JWT, so auth.uid() would be
--      null. The real access boundary is that only trusted server code
--      holding the service-role key can invoke these at all; the Server
--      Action layer (requireAdminActor()) is what checks role = 'admin'
--      before ever calling them.

CREATE POLICY "team_roster_admin_read" ON "public"."team_roster" FOR SELECT TO "authenticated" USING (((SELECT "private"."my_role"()) = 'admin'::"public"."agent_role"));

CREATE FUNCTION "public"."admin_add_roster_member"("p_actor_id" "uuid", "p_org_id" "uuid", "p_upline_id" "uuid", "p_full_name" "text", "p_email" "text", "p_phone" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_upline_org uuid; v_upline_role public.agent_role; v_id uuid;
begin
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'organization not found';
  end if;

  select org_id, role into v_upline_org, v_upline_role
  from public.agents where id = p_upline_id;
  if v_upline_role is null then
    raise exception 'upline not found';
  end if;
  -- Two levels only for now (SMD -> associate, 01-requirements.md) -- a
  -- roster entry an admin adds on an org's behalf reports to that org's
  -- own leader, never to the admin (who isn't part of the org at all).
  if v_upline_role <> 'leader' or v_upline_org is distinct from p_org_id then
    raise exception 'upline must be a leader (SMD) in the target organization';
  end if;

  insert into public.team_roster (org_id, upline_id, created_by, full_name, email, phone)
  values (p_org_id, p_upline_id, p_actor_id, p_full_name, lower(p_email), p_phone)
  returning id into v_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (p_org_id, p_actor_id, 'roster.added_by_admin', 'team_roster', v_id::text,
          jsonb_build_object('upline_id', p_upline_id));

  return v_id;
end $$;

ALTER FUNCTION "public"."admin_add_roster_member"("p_actor_id" "uuid", "p_org_id" "uuid", "p_upline_id" "uuid", "p_full_name" "text", "p_email" "text", "p_phone" "text") OWNER TO "postgres";

CREATE FUNCTION "public"."admin_remove_roster_member"("p_actor_id" "uuid", "p_roster_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_org uuid; v_full_name text;
begin
  select org_id, full_name into v_org, v_full_name from public.team_roster where id = p_roster_id;
  if v_org is null then
    raise exception 'roster entry not found';
  end if;

  delete from public.team_roster where id = p_roster_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'roster.removed_by_admin', 'team_roster', p_roster_id::text,
          jsonb_build_object('full_name', v_full_name));
end $$;

ALTER FUNCTION "public"."admin_remove_roster_member"("p_actor_id" "uuid", "p_roster_id" "uuid") OWNER TO "postgres";

-- Mirrors inviteRosterMemberAction's DB half (create_invitation + the
-- team_roster.invitation_id stamp) but sourced from the roster row's own
-- org_id/upline_id instead of auth.uid()'s -- the service-role client this
-- runs under has neither. Actual email delivery still happens in the
-- Server Action layer, same as every other invite flow (create_invitation
-- itself never sends mail).
CREATE FUNCTION "public"."admin_invite_roster_member"("p_actor_id" "uuid", "p_roster_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_org uuid; v_upline uuid; v_email text; v_id uuid; v_token text;
begin
  select org_id, upline_id, email into v_org, v_upline, v_email
  from public.team_roster where id = p_roster_id;
  if v_org is null then
    raise exception 'roster entry not found';
  end if;
  if v_email is null then
    raise exception 'add an email before inviting';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (org_id, email, upline_id, role, token_hash, created_by)
  values (v_org, v_email, v_upline, 'associate',
          encode(extensions.digest(v_token, 'sha256'), 'hex'), p_actor_id)
  returning id into v_id;

  update public.team_roster set invitation_id = v_id where id = p_roster_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'invitation.created', 'invitation', v_id::text,
          jsonb_build_object('role', 'associate', 'via', 'admin_roster'));

  return v_token;
end $$;

ALTER FUNCTION "public"."admin_invite_roster_member"("p_actor_id" "uuid", "p_roster_id" "uuid") OWNER TO "postgres";

-- CLAUDE.md rule 4: name anon/authenticated explicitly on revoke -- a bare
-- REVOKE ... FROM PUBLIC does not claw back a role's own direct grant.
REVOKE ALL ON FUNCTION "public"."admin_add_roster_member"("p_actor_id" "uuid", "p_org_id" "uuid", "p_upline_id" "uuid", "p_full_name" "text", "p_email" "text", "p_phone" "text") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."admin_add_roster_member"("p_actor_id" "uuid", "p_org_id" "uuid", "p_upline_id" "uuid", "p_full_name" "text", "p_email" "text", "p_phone" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_remove_roster_member"("p_actor_id" "uuid", "p_roster_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remove_roster_member"("p_actor_id" "uuid", "p_roster_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_invite_roster_member"("p_actor_id" "uuid", "p_roster_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."admin_invite_roster_member"("p_actor_id" "uuid", "p_roster_id" "uuid") TO "service_role";
