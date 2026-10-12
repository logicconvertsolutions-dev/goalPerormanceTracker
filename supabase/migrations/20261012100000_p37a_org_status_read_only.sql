-- P37a: org-level read-only / suspended enforcement.
--
-- An organization is 'active', 'read_only' (overdue: view + export only) or
-- 'suspended' (only the SMD can read, for export; associates get nothing).
-- Status is flipped by hand (scripts/set-org-status.sql) until billing exists.
--
-- Enforcement layers (all in the database -- the UI only mirrors them):
--   1. RESTRICTIVE RLS policies on every org-scoped table, ANDed onto the
--      existing permissive policies, which stay untouched.
--   2. Guards inside every authenticated-callable SECURITY DEFINER RPC
--      (definer functions run as the table owner and skip RLS) -- see P37b.
--   3. Column guard on organizations.status/paid_through/status_note so an
--      SMD can never un-suspend their own org.
--
-- Platform admin (agent_role 'admin', org-less) bypasses via the helpers;
-- service_role bypasses RLS natively.
--
-- Account-level rows stay writable in every status (approved exemptions):
-- the agent's own agents row (profile/time zone/terms acceptance),
-- mfa_recovery_codes, notification_prefs, announcement_dismissals,
-- notifications mark-read, feedback, push-subscription removal.
--
-- Re-runnable (CLAUDE.md "Dumped SQL is not automatically safe to re-run").

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
ALTER TABLE "public"."organizations"
  ADD COLUMN IF NOT EXISTS "status" "text" DEFAULT 'active'::"text" NOT NULL,
  ADD COLUMN IF NOT EXISTS "paid_through" "date",
  ADD COLUMN IF NOT EXISTS "status_note" "text";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_status_check'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE "public"."organizations"
      ADD CONSTRAINT "organizations_status_check"
      CHECK (("status" = ANY (ARRAY['active'::"text", 'read_only'::"text", 'suspended'::"text"])));
  END IF;
END $$;

-- Production grants authenticated UPDATE on (name, logo_path) only. A
-- database built from migrations does NOT match that: the baseline's
-- CREATE TABLE picks up ALTER DEFAULT PRIVILEGES' table-level GRANT ALL,
-- and the later column grants never revoked it (rule 4) -- so on
-- staging/local an SMD could update every column, status included. Revoke
-- table-level UPDATE by name and grant back the two columns the app
-- writes (team/organization/actions.ts). No-op on production.
REVOKE UPDATE ON TABLE "public"."organizations" FROM PUBLIC, "anon", "authenticated";
GRANT UPDATE ("name", "logo_path") ON TABLE "public"."organizations" TO "authenticated";

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "private"."is_platform_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce((select a.role = 'admin'::public.agent_role
                   from public.agents a where a.id = (select auth.uid())), false);
$$;

CREATE OR REPLACE FUNCTION "private"."org_status"("p_org_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select o.status from public.organizations o where o.id = p_org_id;
$$;

-- True only when the org is 'active' (or the caller is a platform admin).
-- An unknown/NULL org is not writable.
CREATE OR REPLACE FUNCTION "private"."org_is_writable"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(private.org_status(p_org_id) = 'active', false)
      or private.is_platform_admin();
$$;

-- active / read_only: readable. suspended: only a leader (SMD) of that org.
CREATE OR REPLACE FUNCTION "private"."org_is_readable"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
           case private.org_status(p_org_id)
             when 'active' then true
             when 'read_only' then true
             when 'suspended' then p_org_id = private.my_org()
                                   and private.my_role() = 'leader'::public.agent_role
             else false
           end, false)
      or private.is_platform_admin();
$$;

-- For tables keyed by agent_id only (no org_id column).
CREATE OR REPLACE FUNCTION "private"."agent_org_readable"("p_agent_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.org_is_readable((select a.org_id from public.agents a where a.id = p_agent_id));
$$;

-- Guards for SECURITY DEFINER RPCs (which skip RLS). 42501 =
-- insufficient_privilege; the app maps the ORG_READ_ONLY / ORG_SUSPENDED
-- prefixes to a readable message (lib/org-status.ts).
CREATE OR REPLACE FUNCTION "private"."assert_org_writable"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if private.is_platform_admin() then
    return;
  end if;
  if not private.org_is_writable(private.my_org()) then
    raise exception 'ORG_READ_ONLY: your organization is read-only'
      using errcode = '42501';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."assert_org_readable"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if private.is_platform_admin() then
    return;
  end if;
  if not private.org_is_readable(private.my_org()) then
    raise exception 'ORG_SUSPENDED: your organization is suspended'
      using errcode = '42501';
  end if;
end;
$$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.is_platform_admin()',
    'private.org_status(uuid)',
    'private.org_is_writable(uuid)',
    'private.org_is_readable(uuid)',
    'private.agent_org_readable(uuid)',
    'private.assert_org_writable()',
    'private.assert_org_readable()'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    -- Policies evaluate these as the querying role, which needs EXECUTE
    -- (same as private.my_org / my_role). private schema is not exposed
    -- through PostgREST, so this does not make them RPC-callable.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. Status column guard + audit
-- ---------------------------------------------------------------------
-- Second fence behind the column grants (rule 1): only postgres (SQL
-- editor / migrations / definer RPCs) and service_role may change status.
CREATE OR REPLACE FUNCTION "private"."guard_org_status_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if (new.status, new.paid_through, new.status_note)
       is distinct from (old.status, old.paid_through, old.status_note)
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'ORG_STATUS_LOCKED: organization status can only be changed by the platform'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."audit_org_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (new.status, new.paid_through, new.status_note)
       is distinct from (old.status, old.paid_through, old.status_note) then
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
    values (new.id, (select auth.uid()), 'org.status_changed', 'organization', new.id::text,
            jsonb_build_object(
              'from', old.status, 'to', new.status,
              'paid_through', new.paid_through, 'status_note', new.status_note));
  end if;
  return null;
end;
$$;

ALTER FUNCTION "private"."guard_org_status_columns"() OWNER TO "postgres";
ALTER FUNCTION "private"."audit_org_status_change"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."guard_org_status_columns"() FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "private"."audit_org_status_change"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE TRIGGER "organizations_guard_status" BEFORE UPDATE ON "public"."organizations"
  FOR EACH ROW EXECUTE FUNCTION "private"."guard_org_status_columns"();
CREATE OR REPLACE TRIGGER "organizations_audit_status" AFTER UPDATE ON "public"."organizations"
  FOR EACH ROW EXECUTE FUNCTION "private"."audit_org_status_change"();

-- ---------------------------------------------------------------------
-- 4. Restrictive RLS
-- ---------------------------------------------------------------------
-- Tables with an org_id column: reads need org_is_readable(org_id), every
-- write needs org_is_writable(org_id). Policies that a table has no grant
-- or permissive policy for are still created -- they cost nothing and
-- keep the fence in place if a grant/policy is added later.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'call_logs', 'appointments', 'sales', 'recruiting_logs',
    'tasks', 'reminders', 'pending_calls', 'targets', 'invitations',
    'team_roster', 'daily_metrics', 'audit_log', 'push_subscriptions'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_org_readable', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated '
                   'USING (private.org_is_readable(org_id))', t || '_org_readable', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_org_writable_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated '
                   'WITH CHECK (private.org_is_writable(org_id))', t || '_org_writable_ins', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_org_writable_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated '
                   'USING (private.org_is_writable(org_id)) WITH CHECK (private.org_is_writable(org_id))',
                   t || '_org_writable_upd', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_org_writable_del', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated '
                   'USING (private.org_is_writable(org_id))', t || '_org_writable_del', t);
  END LOOP;
END $$;

-- notifications: reads fenced; mark-read (UPDATE) exempt -- UI state, not
-- org data. Inserts/deletes are system-only already; fence them anyway.
DROP POLICY IF EXISTS "notifications_org_readable" ON "public"."notifications";
CREATE POLICY "notifications_org_readable" ON "public"."notifications" AS RESTRICTIVE FOR SELECT TO "authenticated"
  USING ("private"."org_is_readable"("org_id"));
DROP POLICY IF EXISTS "notifications_org_writable_ins" ON "public"."notifications";
CREATE POLICY "notifications_org_writable_ins" ON "public"."notifications" AS RESTRICTIVE FOR INSERT TO "authenticated"
  WITH CHECK ("private"."org_is_writable"("org_id"));
DROP POLICY IF EXISTS "notifications_org_writable_del" ON "public"."notifications";
CREATE POLICY "notifications_org_writable_del" ON "public"."notifications" AS RESTRICTIVE FOR DELETE TO "authenticated"
  USING ("private"."org_is_writable"("org_id"));

-- organizations: the caller's own org row stays readable in every status
-- (the app needs it to show the read-only banner / suspended screen).
-- Writes (name, logo) need an active org.
DROP POLICY IF EXISTS "organizations_org_readable" ON "public"."organizations";
CREATE POLICY "organizations_org_readable" ON "public"."organizations" AS RESTRICTIVE FOR SELECT TO "authenticated"
  USING ((("id" = ( SELECT "private"."my_org"() AS "my_org")) OR "private"."org_is_readable"("id")));
DROP POLICY IF EXISTS "organizations_org_writable_ins" ON "public"."organizations";
CREATE POLICY "organizations_org_writable_ins" ON "public"."organizations" AS RESTRICTIVE FOR INSERT TO "authenticated"
  WITH CHECK (( SELECT "private"."is_platform_admin"() AS "is_platform_admin"));
DROP POLICY IF EXISTS "organizations_org_writable_upd" ON "public"."organizations";
CREATE POLICY "organizations_org_writable_upd" ON "public"."organizations" AS RESTRICTIVE FOR UPDATE TO "authenticated"
  USING ("private"."org_is_writable"("id")) WITH CHECK ("private"."org_is_writable"("id"));
DROP POLICY IF EXISTS "organizations_org_writable_del" ON "public"."organizations";
CREATE POLICY "organizations_org_writable_del" ON "public"."organizations" AS RESTRICTIVE FOR DELETE TO "authenticated"
  USING ("private"."org_is_writable"("id"));

-- agents: own row always readable (session load); everyone else's needs a
-- readable org. Self-update stays allowed (approved exemption: profile,
-- time zone, terms acceptance). Inserts/deletes are system-only already.
DROP POLICY IF EXISTS "agents_org_readable" ON "public"."agents";
CREATE POLICY "agents_org_readable" ON "public"."agents" AS RESTRICTIVE FOR SELECT TO "authenticated"
  USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR "private"."org_is_readable"("org_id")));

-- agent_closure: hierarchy ids only, but suspended associates get nothing.
DROP POLICY IF EXISTS "agent_closure_org_readable" ON "public"."agent_closure";
CREATE POLICY "agent_closure_org_readable" ON "public"."agent_closure" AS RESTRICTIVE FOR SELECT TO "authenticated"
  USING ("private"."agent_org_readable"("ancestor_id"));

-- ---------------------------------------------------------------------
-- 5. Storage: org-logos (path "<org_id>/logo.<ext>")
-- ---------------------------------------------------------------------
-- The three permissive policies below were created in the dashboard and
-- never captured in a migration, so branches built from migrations
-- (staging, local) lacked them. Captured here VERBATIM from production's
-- pg_policies (2026-10-12) -- recreating them is a no-op on production.
-- (There is no DELETE policy, so "Remove logo" doesn't delete the object;
-- pre-existing, left as-is here.)
DROP POLICY IF EXISTS "org_logos_select" ON "storage"."objects";
CREATE POLICY "org_logos_select" ON "storage"."objects" FOR SELECT TO "authenticated"
  USING ((("bucket_id" = 'org-logos'::"text") AND (("storage"."foldername"("name"))[1] = ( SELECT ("private"."my_org"())::"text" AS "my_org"))));
DROP POLICY IF EXISTS "org_logos_write" ON "storage"."objects";
CREATE POLICY "org_logos_write" ON "storage"."objects" FOR INSERT TO "authenticated"
  WITH CHECK ((("bucket_id" = 'org-logos'::"text") AND (("storage"."foldername"("name"))[1] = ( SELECT ("private"."my_org"())::"text" AS "my_org")) AND (( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"]))));
DROP POLICY IF EXISTS "org_logos_update" ON "storage"."objects";
CREATE POLICY "org_logos_update" ON "storage"."objects" FOR UPDATE TO "authenticated"
  USING ((("bucket_id" = 'org-logos'::"text") AND (("storage"."foldername"("name"))[1] = ( SELECT ("private"."my_org"())::"text" AS "my_org")) AND (( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"]))));

-- Restrictive fences, scoped to this bucket only (other buckets pass
-- through untouched). The folder name is matched as text against
-- organizations.id, so a malformed path can't raise a uuid cast error --
-- it just resolves to no org (not writable/readable).
DROP POLICY IF EXISTS "org_logos_org_readable" ON "storage"."objects";
CREATE POLICY "org_logos_org_readable" ON "storage"."objects" AS RESTRICTIVE FOR SELECT TO "authenticated"
  USING ((("bucket_id" <> 'org-logos'::"text") OR "private"."org_is_readable"(( SELECT "o"."id" FROM "public"."organizations" "o" WHERE ("o"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]))));
DROP POLICY IF EXISTS "org_logos_org_writable_ins" ON "storage"."objects";
CREATE POLICY "org_logos_org_writable_ins" ON "storage"."objects" AS RESTRICTIVE FOR INSERT TO "authenticated"
  WITH CHECK ((("bucket_id" <> 'org-logos'::"text") OR "private"."org_is_writable"(( SELECT "o"."id" FROM "public"."organizations" "o" WHERE ("o"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]))));
DROP POLICY IF EXISTS "org_logos_org_writable_upd" ON "storage"."objects";
CREATE POLICY "org_logos_org_writable_upd" ON "storage"."objects" AS RESTRICTIVE FOR UPDATE TO "authenticated"
  USING ((("bucket_id" <> 'org-logos'::"text") OR "private"."org_is_writable"(( SELECT "o"."id" FROM "public"."organizations" "o" WHERE ("o"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]))))
  WITH CHECK ((("bucket_id" <> 'org-logos'::"text") OR "private"."org_is_writable"(( SELECT "o"."id" FROM "public"."organizations" "o" WHERE ("o"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]))));
DROP POLICY IF EXISTS "org_logos_org_writable_del" ON "storage"."objects";
CREATE POLICY "org_logos_org_writable_del" ON "storage"."objects" AS RESTRICTIVE FOR DELETE TO "authenticated"
  USING ((("bucket_id" <> 'org-logos'::"text") OR "private"."org_is_writable"(( SELECT "o"."id" FROM "public"."organizations" "o" WHERE ("o"."id")::"text" = ("storage"."foldername"("objects"."name"))[1]))));
