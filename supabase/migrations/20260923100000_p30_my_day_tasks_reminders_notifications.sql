-- P30: My Day redesign -- to-dos, reminders, in-app notifications, web push.
--
-- Four new tables, all strictly owner-only. None of them has an upline
-- policy (CLAUDE.md rule 2): an SMD never sees a downline's to-dos,
-- reminders or notifications, which can carry prospect names.
--
--   tasks               the My Day "To Do" list
--   reminders           user-created reminders; the job below delivers them
--   notifications       the bell feed; rows are only ever written by the job
--   push_subscriptions  one row per browser/device that enabled web push;
--                       service-role read only (the endpoint is a bearer
--                       capability for pushing to that device)
--
-- Two fences on every table (rule 8): org_id is stamped from the agent by the
-- existing public.set_org_from_agent() trigger, and every policy checks both
-- agent_id = auth.uid() AND org_id = private.my_org().
--
-- Delivery reuses the P14 pipeline shape: a pg_cron job claims due items into
-- `notifications` (idempotent via a unique source_key), enqueues the ones to
-- push on a pgmq queue, and a second job pings a bounded Vercel drain route
-- (/api/cron/push/drain) through the existing private.ping_app_route(). None
-- of this touches daily_metrics or recompute_day.
--
-- Re-runnable: every object is guarded (IF NOT EXISTS / DO blocks /
-- CREATE OR REPLACE / cron.schedule upserts by name) -- see CLAUDE.md
-- "Dumped SQL is not automatically safe to re-run".

-- ---------------------------------------------------------------------
-- 1. tasks
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "agent_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "title" "text" NOT NULL,
    "kind" "text" DEFAULT 'task'::"text" NOT NULL,
    "due_on" "date" NOT NULL,
    "due_at" timestamp with time zone,
    "contact_id" "uuid",
    "done_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tasks_title_check" CHECK (("char_length"("btrim"("title")) BETWEEN 1 AND 200)),
    CONSTRAINT "tasks_kind_check" CHECK (("kind" = ANY (ARRAY['call'::"text", 'task'::"text", 'meeting'::"text", 'follow_up'::"text"]))),
    CONSTRAINT "tasks_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE,
    CONSTRAINT "tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "tasks_agent_due_idx" ON "public"."tasks" ("agent_id", "due_on");

-- ---------------------------------------------------------------------
-- 2. reminders
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "agent_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "title" "text" NOT NULL,
    "remind_at" timestamp with time zone NOT NULL,
    "lead_minutes" integer DEFAULT 0 NOT NULL,
    "push" boolean DEFAULT true NOT NULL,
    "contact_id" "uuid",
    "appointment_id" "uuid",
    "sent_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reminders_title_check" CHECK (("char_length"("btrim"("title")) BETWEEN 1 AND 200)),
    CONSTRAINT "reminders_lead_minutes_check" CHECK (("lead_minutes" = ANY (ARRAY[0, 5, 10, 15, 30, 60, 120, 1440]))),
    CONSTRAINT "reminders_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE,
    CONSTRAINT "reminders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "reminders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL,
    CONSTRAINT "reminders_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "reminders_agent_remind_idx" ON "public"."reminders" ("agent_id", "remind_at");
-- The job's scan: only undelivered, undismissed reminders.
CREATE INDEX IF NOT EXISTS "reminders_pending_idx" ON "public"."reminders" ("remind_at")
  WHERE "sent_at" IS NULL AND "dismissed_at" IS NULL;

-- ---------------------------------------------------------------------
-- 3. notifications (bell feed)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "link" "text",
    -- What produced this row, e.g. 'reminder:<id>', 'appt15:<id>:<ts>',
    -- 'brief:<local date>'. Unique per agent -- this is what makes the job
    -- idempotent when cron overlaps or re-runs.
    "source_key" "text" NOT NULL,
    "push" boolean DEFAULT false NOT NULL,
    "pushed_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_kind_check" CHECK (("kind" = ANY (ARRAY['reminder'::"text", 'appointment'::"text", 'morning_brief'::"text"]))),
    CONSTRAINT "notifications_link_check" CHECK ((("link" IS NULL) OR ("link" ~ '^/[A-Za-z0-9/_?=&.-]*$'))),
    CONSTRAINT "notifications_agent_source_key" UNIQUE ("agent_id", "source_key"),
    CONSTRAINT "notifications_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE,
    CONSTRAINT "notifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "notifications_agent_created_idx" ON "public"."notifications" ("agent_id", "created_at" DESC);

-- ---------------------------------------------------------------------
-- 4. push_subscriptions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint"),
    CONSTRAINT "push_subscriptions_endpoint_check" CHECK ((("endpoint" ~ '^https://') AND ("char_length"("endpoint") <= 1000))),
    CONSTRAINT "push_subscriptions_keys_check" CHECK ((("char_length"("p256dh") BETWEEN 1 AND 200) AND ("char_length"("auth") BETWEEN 1 AND 100))),
    CONSTRAINT "push_subscriptions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE,
    CONSTRAINT "push_subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "push_subscriptions_agent_idx" ON "public"."push_subscriptions" ("agent_id");

-- ---------------------------------------------------------------------
-- 5. notification_prefs: push toggles (default on, like the email ones)
-- ---------------------------------------------------------------------
ALTER TABLE "public"."notification_prefs"
  ADD COLUMN IF NOT EXISTS "push_reminders" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "push_appointments" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "push_morning_brief" boolean DEFAULT true NOT NULL;

-- ---------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------
-- org_id stamping: the same function every other agent-owned table uses.
CREATE OR REPLACE TRIGGER "tasks_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."tasks"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent"();
CREATE OR REPLACE TRIGGER "reminders_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."reminders"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent"();
CREATE OR REPLACE TRIGGER "notifications_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."notifications"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent"();
CREATE OR REPLACE TRIGGER "push_subscriptions_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."push_subscriptions"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent"();

-- A to-do or reminder may only point at the owner's OWN contact/appointment.
-- A foreign key alone would accept any agent's id; RLS on the parent table
-- does not apply to FK checks.
CREATE OR REPLACE FUNCTION "private"."assert_own_linked_records"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.contact_id is not null and not exists (
    select 1 from public.contacts c where c.id = new.contact_id and c.agent_id = new.agent_id
  ) then
    raise exception 'contact % does not belong to this agent', new.contact_id using errcode = '42501';
  end if;

  -- Nested, not `tg_table_name = 'reminders' and new.appointment_id ...`:
  -- plpgsql resolves new.appointment_id even when the first operand is
  -- false, and tasks has no such column.
  if tg_table_name = 'reminders' then
    if new.appointment_id is not null and not exists (
      select 1 from public.appointments ap where ap.id = new.appointment_id and ap.agent_id = new.agent_id
    ) then
      raise exception 'appointment % does not belong to this agent', new.appointment_id using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

ALTER FUNCTION "private"."assert_own_linked_records"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."assert_own_linked_records"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE TRIGGER "tasks_own_links" BEFORE INSERT OR UPDATE OF "contact_id", "agent_id" ON "public"."tasks"
  FOR EACH ROW EXECUTE FUNCTION "private"."assert_own_linked_records"();
CREATE OR REPLACE TRIGGER "reminders_own_links" BEFORE INSERT OR UPDATE OF "contact_id", "appointment_id", "agent_id" ON "public"."reminders"
  FOR EACH ROW EXECUTE FUNCTION "private"."assert_own_linked_records"();

-- Moving a reminder's time re-arms it: an already-delivered reminder that
-- the agent pushes to later must fire again at the new time. sent_at itself
-- is not user-writable (column grants below), so this is the only way it
-- goes back to null.
CREATE OR REPLACE FUNCTION "private"."rearm_reminder"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if (new.remind_at, new.lead_minutes) is distinct from (old.remind_at, old.lead_minutes) then
    new.sent_at := null;
  end if;
  return new;
end $$;

ALTER FUNCTION "private"."rearm_reminder"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."rearm_reminder"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE TRIGGER "reminders_rearm" BEFORE UPDATE OF "remind_at", "lead_minutes" ON "public"."reminders"
  FOR EACH ROW EXECUTE FUNCTION "private"."rearm_reminder"();

-- ---------------------------------------------------------------------
-- 7. RLS + privileges
-- ---------------------------------------------------------------------
ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_own" ON "public"."tasks";
CREATE POLICY "tasks_own" ON "public"."tasks" TO "authenticated"
  USING ((("agent_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))))
  WITH CHECK ((("agent_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))));

DROP POLICY IF EXISTS "reminders_own" ON "public"."reminders";
CREATE POLICY "reminders_own" ON "public"."reminders" TO "authenticated"
  USING ((("agent_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))))
  WITH CHECK ((("agent_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))));

DROP POLICY IF EXISTS "notifications_own_select" ON "public"."notifications";
CREATE POLICY "notifications_own_select" ON "public"."notifications" FOR SELECT TO "authenticated"
  USING ((("agent_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))));

DROP POLICY IF EXISTS "notifications_own_mark_read" ON "public"."notifications";
CREATE POLICY "notifications_own_mark_read" ON "public"."notifications" FOR UPDATE TO "authenticated"
  USING ((("agent_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))))
  WITH CHECK ((("agent_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))));

-- push_subscriptions: RLS on with NO policy for authenticated -- all access
-- goes through the two RPCs below or the service role.

-- ALTER DEFAULT PRIVILEGES in the baseline grants ALL on new public tables
-- directly to anon and authenticated, so revoke by name (rule 4), then grant
-- back exactly what each table needs.
REVOKE ALL ON TABLE "public"."tasks", "public"."reminders", "public"."notifications", "public"."push_subscriptions"
  FROM PUBLIC, "anon", "authenticated";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."tasks" TO "authenticated";

-- reminders: everything except sent_at, which only the job writes (rule 1:
-- a privileged column on a row the user can update is protected by grants,
-- not a policy). org_id is insertable because the app sends it like every
-- other agent-owned insert, but set_org_from_agent() overwrites it anyway.
GRANT SELECT, DELETE ON TABLE "public"."reminders" TO "authenticated";
GRANT INSERT ("id", "org_id", "agent_id", "title", "remind_at", "lead_minutes", "push", "contact_id", "appointment_id", "dismissed_at")
  ON TABLE "public"."reminders" TO "authenticated";
GRANT UPDATE ("title", "remind_at", "lead_minutes", "push", "contact_id", "appointment_id", "dismissed_at")
  ON TABLE "public"."reminders" TO "authenticated";

-- notifications: read, and mark read. Nothing else.
GRANT SELECT ON TABLE "public"."notifications" TO "authenticated";
GRANT UPDATE ("read_at") ON TABLE "public"."notifications" TO "authenticated";

GRANT ALL ON TABLE "public"."tasks", "public"."reminders", "public"."notifications", "public"."push_subscriptions" TO "service_role";

-- ---------------------------------------------------------------------
-- 8. Push subscription RPCs (the only authenticated path to that table)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."save_push_subscription"(
    "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text" DEFAULT NULL
) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or private.my_org() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- One browser has one endpoint. If someone else was signed in on this
  -- device before, the subscription moves to whoever enabled it last.
  insert into public.push_subscriptions (agent_id, endpoint, p256dh, auth, user_agent)
  values (v_me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set agent_id = excluded.agent_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();
end $$;

ALTER FUNCTION "public"."save_push_subscription"("text", "text", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."save_push_subscription"("text", "text", "text", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."save_push_subscription"("text", "text", "text", "text") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."delete_push_subscription"("p_endpoint" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  delete from public.push_subscriptions
  where endpoint = p_endpoint and agent_id = (select auth.uid());
$$;

ALTER FUNCTION "public"."delete_push_subscription"("text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."delete_push_subscription"("text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."delete_push_subscription"("text") TO "authenticated";

-- ---------------------------------------------------------------------
-- 9. Delivery job
-- ---------------------------------------------------------------------
-- pgmq.create is idempotent (CREATE ... IF NOT EXISTS inside).
SELECT pgmq.create('push_sends');

-- Claims everything due right now into `notifications` and enqueues the
-- ones that should also go out as a push. Safe to run concurrently or
-- repeatedly: the (agent_id, source_key) unique key means an item is
-- claimed exactly once, and only freshly claimed rows are enqueued.
--
-- Three sources:
--   reminder      remind_at - lead_minutes has passed (within the last day,
--                 so a long outage doesn't fire a backlog of stale ones)
--   appointment   a scheduled appointment starts in the next 15 minutes
--   morning_brief once per agent-local day, 08:00-10:59 local
CREATE OR REPLACE FUNCTION "private"."enqueue_due_pushes"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_enqueued int := 0;
  rec record;
begin
  -- 1. Reminders.
  with due as (
    select r.id, r.agent_id, r.title, r.push, r.remind_at,
           coalesce(nullif(a.time_zone, ''), 'America/New_York') as tz
    from public.reminders r
    join public.agents a on a.id = r.agent_id and a.status = 'active'
    where r.sent_at is null
      and r.dismissed_at is null
      and r.remind_at - make_interval(mins => r.lead_minutes) <= now()
      and r.remind_at - make_interval(mins => r.lead_minutes) > now() - interval '1 day'
    for update of r skip locked
  ),
  marked as (
    update public.reminders r set sent_at = now()
    from due where r.id = due.id
    returning r.id
  )
  insert into public.notifications (agent_id, kind, title, body, link, source_key, push)
  select d.agent_id, 'reminder', d.title,
         'Reminder for ' || to_char(d.remind_at at time zone d.tz, 'FMHH12:MI AM'),
         '/today', 'reminder:' || d.id::text,
         d.push and coalesce(p.push_reminders, true)
  from due d
  join marked m on m.id = d.id
  left join public.notification_prefs p on p.agent_id = d.agent_id
  on conflict (agent_id, source_key) do nothing;

  -- 2. Appointments starting within 15 minutes. The key carries the
  --    scheduled time, so a rescheduled slot alerts again.
  insert into public.notifications (agent_id, kind, title, body, link, source_key, push)
  select ap.agent_id, 'appointment',
         'Appointment in ' || greatest(1, ceil(extract(epoch from ap.scheduled_for - now()) / 60))::int || ' min',
         ct.full_name || ' · ' || to_char(ap.scheduled_for at time zone coalesce(nullif(a.time_zone, ''), 'America/New_York'), 'FMHH12:MI AM'),
         '/appointments',
         'appt15:' || ap.id::text || ':' || extract(epoch from ap.scheduled_for)::bigint::text,
         coalesce(p.push_appointments, true)
  from public.appointments ap
  join public.agents a on a.id = ap.agent_id and a.status = 'active'
  join public.contacts ct on ct.id = ap.contact_id
  left join public.notification_prefs p on p.agent_id = ap.agent_id
  where ap.status = 'scheduled'
    and ap.scheduled_for > now()
    and ap.scheduled_for <= now() + interval '15 minutes'
  on conflict (agent_id, source_key) do nothing;

  -- 3. Morning brief. Counts only the agent's OWN rows for their own local
  --    day -- a greeting, not a metric (dashboards still read daily_metrics).
  insert into public.notifications (agent_id, kind, title, body, link, source_key, push)
  select n.agent_id, 'morning_brief',
         'Good morning, ' || split_part(n.full_name, ' ', 1),
         c.appts || case when c.appts = 1 then ' appointment · ' else ' appointments · ' end
           || c.todos || case when c.todos = 1 then ' to-do' else ' to-dos' end
           || ' today. Open My Day to get started.',
         '/today',
         'brief:' || n.local_date::text,
         coalesce(p.push_morning_brief, true)
  from (
    select a.id as agent_id, a.full_name,
           coalesce(nullif(a.time_zone, ''), 'America/New_York') as tz,
           (now() at time zone coalesce(nullif(a.time_zone, ''), 'America/New_York')) as local_ts,
           (now() at time zone coalesce(nullif(a.time_zone, ''), 'America/New_York'))::date as local_date
    from public.agents a
    where a.status = 'active' and a.role in ('associate', 'leader')
  ) n
  cross join lateral (
    select
      (select count(*) from public.appointments ap
         where ap.agent_id = n.agent_id and ap.status = 'scheduled'
           and (ap.scheduled_for at time zone n.tz)::date = n.local_date) as appts,
      (select count(*) from public.tasks t
         where t.agent_id = n.agent_id and t.done_at is null and t.due_on = n.local_date) as todos
  ) c
  left join public.notification_prefs p on p.agent_id = n.agent_id
  where extract(hour from n.local_ts) >= 8
    and extract(hour from n.local_ts) < 11
  on conflict (agent_id, source_key) do nothing;

  -- Enqueue every push-flagged row claimed above and not yet sent. Rows are
  -- picked by pushed_at IS NULL + a recent created_at, so a crash between
  -- the inserts and here is recovered on the next tick rather than lost.
  for rec in
    select nt.id
    from public.notifications nt
    where nt.push and nt.pushed_at is null
      and nt.created_at > now() - interval '10 minutes'
      and not exists (select 1 from pgmq.q_push_sends q where (q.message ->> 'notification_id')::uuid = nt.id)
  loop
    perform pgmq.send('push_sends', jsonb_build_object('notification_id', rec.id));
    v_enqueued := v_enqueued + 1;
  end loop;

  return v_enqueued;
end $$;

ALTER FUNCTION "private"."enqueue_due_pushes"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."enqueue_due_pushes"() FROM PUBLIC, "anon", "authenticated";

-- Pings the drain route only when there is something to send, so an idle
-- minute costs no Vercel invocation.
CREATE OR REPLACE FUNCTION "private"."ping_push_drain"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (select 1 from pgmq.q_push_sends) then
    perform private.ping_app_route('/api/cron/push/drain');
  end if;
end $$;

ALTER FUNCTION "private"."ping_push_drain"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."ping_push_drain"() FROM PUBLIC, "anon", "authenticated";

-- Retention: the bell only ever shows recent items.
CREATE OR REPLACE FUNCTION "private"."purge_old_notifications"() RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with gone as (
    delete from public.notifications where created_at < now() - interval '60 days' returning 1
  )
  select count(*)::int from gone;
$$;

ALTER FUNCTION "private"."purge_old_notifications"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."purge_old_notifications"() FROM PUBLIC, "anon", "authenticated";

SELECT cron.schedule('enqueue-due-pushes', '* * * * *', $$SELECT private.enqueue_due_pushes()$$);
SELECT cron.schedule('ping-push-drain', '* * * * *', $$SELECT private.ping_push_drain()$$);
SELECT cron.schedule('purge-old-notifications', '45 3 * * *', $$SELECT private.purge_old_notifications()$$);
