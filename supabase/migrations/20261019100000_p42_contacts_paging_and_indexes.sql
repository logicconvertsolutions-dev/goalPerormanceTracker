-- P42: Contacts screen pages in the database; indexes for contact lookups.
--
-- The Contacts screen read every contact the agent owns plus every call
-- logged against each one, in one PostgREST request, and summarised them in
-- the browser. PostgREST caps a response at max_rows (1000) without saying
-- so, so an agent with more than 1,000 contacts silently lost everyone after
-- roughly "M" -- and the request grew with every call logged.
--
-- So:
--   1. public.my_contacts(p_q, p_limit, p_offset): one page of the caller's
--      contacts, sorted by name, with the per-contact call summary the
--      screen shows (times called, last call + outcome, next open follow-up)
--      computed here, and the total match count for the pager.
--      SECURITY INVOKER: it reads only the caller's own rows, so RLS
--      (contacts_own, call_logs_own) stays the boundary -- no definer
--      function, nothing that could cross the hierarchy (rule 2). It still
--      checks agent_id and org_id itself (rule 8).
--   2. pg_trgm + trigram GIN indexes on contacts.full_name and .notes, so
--      the screen's "contains" search (ILIKE '%term%') doesn't have to read
--      every one of the agent's contacts.
--   3. Covering indexes on the contact_id / org_id foreign keys the Supabase
--      performance advisor flagged. contact_id is how a contact's activity
--      is looked up (and how ON DELETE CASCADE finds rows when a contact is
--      deleted); org_id is filtered by every policy.
--
-- Plain CREATE INDEX (not CONCURRENTLY -- migrations run in a transaction).
-- The tables are small (production: ~12k contacts, <1k call_logs), so each
-- build is milliseconds.
--
-- Re-runnable (CLAUDE.md "Dumped SQL is not automatically safe to re-run").

-- ---------------------------------------------------------------------
-- 1. pg_trgm + search indexes
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";

CREATE INDEX IF NOT EXISTS "contacts_full_name_trgm_idx"
  ON "public"."contacts" USING "gin" ("full_name" "extensions"."gin_trgm_ops");
CREATE INDEX IF NOT EXISTS "contacts_notes_trgm_idx"
  ON "public"."contacts" USING "gin" ("notes" "extensions"."gin_trgm_ops");

-- ---------------------------------------------------------------------
-- 2. Foreign-key indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "call_logs_contact_idx"       ON "public"."call_logs"       ("contact_id");
CREATE INDEX IF NOT EXISTS "appointments_contact_idx"    ON "public"."appointments"    ("contact_id");
CREATE INDEX IF NOT EXISTS "sales_contact_idx"           ON "public"."sales"           ("contact_id");
CREATE INDEX IF NOT EXISTS "recruiting_logs_contact_idx" ON "public"."recruiting_logs" ("contact_id");
CREATE INDEX IF NOT EXISTS "tasks_contact_idx"           ON "public"."tasks"           ("contact_id");
CREATE INDEX IF NOT EXISTS "reminders_contact_idx"       ON "public"."reminders"       ("contact_id");
CREATE INDEX IF NOT EXISTS "pending_calls_contact_idx"   ON "public"."pending_calls"   ("contact_id");

CREATE INDEX IF NOT EXISTS "contacts_org_idx"           ON "public"."contacts"           ("org_id");
CREATE INDEX IF NOT EXISTS "tasks_org_idx"              ON "public"."tasks"              ("org_id");
CREATE INDEX IF NOT EXISTS "reminders_org_idx"          ON "public"."reminders"          ("org_id");
CREATE INDEX IF NOT EXISTS "notifications_org_idx"      ON "public"."notifications"      ("org_id");
CREATE INDEX IF NOT EXISTS "pending_calls_org_idx"      ON "public"."pending_calls"      ("org_id");
CREATE INDEX IF NOT EXISTS "push_subscriptions_org_idx" ON "public"."push_subscriptions" ("org_id");

-- ---------------------------------------------------------------------
-- 3. public.my_contacts
-- ---------------------------------------------------------------------
-- p_q: optional search, matched case-insensitively as a substring of the
-- name or the notes. LIKE wildcards in it are escaped, so "50%" means the
-- literal text.
-- Sort: lower(full_name), then id -- a stable order, so paging never
-- repeats or skips a contact. total_count is the number of matches before
-- paging (the same on every row).
CREATE OR REPLACE FUNCTION "public"."my_contacts"(
  "p_q" "text" DEFAULT NULL,
  "p_limit" integer DEFAULT 50,
  "p_offset" integer DEFAULT 0
) RETURNS TABLE(
  "id" "uuid",
  "full_name" "text",
  "phone_number" "text",
  "notes" "text",
  "times_called" integer,
  "last_call_date" "date",
  "last_outcome" "public"."call_outcome",
  "next_follow_up" "date",
  "total_count" bigint
)
    LANGUAGE "sql" STABLE SECURITY INVOKER
    SET "search_path" TO ''
    AS $$
  with me as (
    select a.id, a.org_id from public.agents a where a.id = (select auth.uid())
  ),
  pattern as (
    select case
      when nullif(btrim(p_q), '') is null then null
      else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as p
  ),
  matched as (
    select c.id, c.full_name, c.phone_number, c.notes,
           count(*) over () as total_count
    from public.contacts c
    cross join me
    cross join pattern
    where c.agent_id = me.id
      and c.org_id = me.org_id
      and (pattern.p is null or c.full_name ilike pattern.p or c.notes ilike pattern.p)
    order by lower(c.full_name), c.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select m.id, m.full_name, m.phone_number, m.notes,
         coalesce(stats.times_called, 0),
         last_call.call_date,
         last_call.outcome,
         stats.next_follow_up,
         m.total_count
  from matched m
  left join lateral (
    select count(*)::int as times_called,
           min(cl.follow_up_on) filter (
             where cl.follow_up_on is not null and cl.follow_up_done_at is null
           ) as next_follow_up
    from public.call_logs cl
    where cl.contact_id = m.id
  ) stats on true
  left join lateral (
    select cl.call_date, cl.outcome
    from public.call_logs cl
    where cl.contact_id = m.id
    order by cl.call_date desc, cl.created_at desc
    limit 1
  ) last_call on true
  order by lower(m.full_name), m.id;
$$;

ALTER FUNCTION "public"."my_contacts"("p_q" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";

-- Rule 4: name anon and authenticated explicitly.
REVOKE ALL ON FUNCTION "public"."my_contacts"("p_q" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_contacts"("p_q" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_contacts"("p_q" "text", "p_limit" integer, "p_offset" integer) TO "service_role";
