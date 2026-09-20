-- P25 Phase B -- appointment identity. Additive schema + a trigger that
-- keeps the old columns correct, so every existing reader and the current
-- app code keep working untouched. No column is dropped. No UI change.
-- Full context in
-- `.github/Spec Sheets/12-appointment-lifecycle-remediation.md`.
--
-- ---------------------------------------------------------------------
-- THE PROBLEM THIS SOLVES
--
-- An appointment has no identity of its own. `appt_date` means "scheduled
-- for" while the appointment is pending and "resolved on" once it isn't, so
-- no single question can be asked of it, and resolving an appointment
-- destroys the record of when it actually was (F8):
--
--   * updateAppointmentStatusAction rewrites appt_date to today
--   * updateAppointmentAction additionally nulls appointment_at
--   * ...so the two code paths leave DIFFERENT rows for the same action,
--     and after either one, "when was that appointment?" is unanswerable
--
-- Phase B splits that one overloaded column into three honest ones:
--
--   set_on        the day it was BOOKED        -- immutable
--   scheduled_for the slot it is/was FOR       -- immutable once resolved
--   resolved_on   the day the OUTCOME was recorded
--
-- `appt_date` stays, maintained by trigger as
-- coalesce(resolved_on, scheduled_for::date, appt_date), so every query,
-- index and page that reads it today keeps working through Phases B-D.
--
-- ---------------------------------------------------------------------
-- WHY THE TRIGGER DOES THE WORK, NOT THE APP
--
-- The plan called for the server actions to dual-write old and new columns.
-- Doing it in a BEFORE trigger instead is strictly safer: the invariant
-- holds for EVERY writer -- the live app, the offline replay queue
-- (which can submit a pre-Phase-B payload days later, E15), the import
-- path, and psql -- rather than only the code paths we remembered to
-- update. It also means Phase B ships with NO application change at all,
-- so this migration can go to production on its own and be judged on the
-- data alone.
--
-- ---------------------------------------------------------------------
-- F4 (double counting) -- the clause lands here, the fix arrives in Phase C
--
-- recompute_day now counts a call log with outcome='appointment_set' only
-- when no appointment row points back at it via source_call_log_id. Today
-- nothing sets that column, so the clause is a NO-OP and no number moves.
-- It starts working in Phase C, when the call form creates the appointment
-- and stamps the link.
--
-- source_call_log_id is deliberately NOT backfilled for historical rows.
-- Two reasons:
--   1. The plan's D4 -- matching legacy rows means guessing, and a wrong
--      guess silently merges two real appointments into one.
--   2. Phase A's restatement was announced to agents as "no number goes
--      down". A retro-link would dedup historical days and could push
--      Appts Set DOWN within hours of saying that. If we later decide the
--      legacy double count is worth correcting, it gets its own migration
--      and its own announcement.
-- The end of this file has a read-only query for measuring how many
-- historical rows are actually affected, so that decision can be made on
-- numbers rather than guesswork.
--
-- ---------------------------------------------------------------------
-- WHAT DOES NOT CHANGE HERE
--
-- The appt_scheduled/held/no_show/rescheduled/cancelled counts stay
-- bucketed by appt_date, NOT moved to resolved_on. They are equivalent by
-- construction -- the trigger maintains appt_date = resolved_on for every
-- terminal row -- so bucketing by either gives identical numbers, and
-- keeping appt_date means this migration moves exactly one metric
-- (appts_set, from a case expression to a column read) instead of six.
-- Fewer moving parts, and the Phase A verification queries stay valid.

-- ---------------------------------------------------------------------
-- 1. Columns. All nullable at first; set_on is tightened in step 4 once
--    the backfill has proven 100% coverage.
-- ---------------------------------------------------------------------
alter table "public"."appointments"
  add column if not exists "set_on"        date,
  add column if not exists "scheduled_for" timestamp with time zone,
  add column if not exists "resolved_on"   date,
  add column if not exists "source_call_log_id" uuid,
  add column if not exists "rescheduled_to_id"  uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_source_call_log_id_fkey'
  ) then
    alter table public.appointments
      add constraint appointments_source_call_log_id_fkey
      foreign key (source_call_log_id) references public.call_logs(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_rescheduled_to_id_fkey'
  ) then
    alter table public.appointments
      add constraint appointments_rescheduled_to_id_fkey
      foreign key (rescheduled_to_id) references public.appointments(id) on delete set null;
  end if;
end $$;

comment on column public.appointments.set_on is
  'Day the appointment was booked, in the agent''s zone. Immutable. The bucket for appts_set.';
comment on column public.appointments.scheduled_for is
  'The appointment''s own date and time. Immutable once the row is terminal -- this is what F8 used to destroy.';
comment on column public.appointments.resolved_on is
  'Day the outcome was recorded. Null while status = scheduled.';
comment on column public.appointments.source_call_log_id is
  'The call that set this appointment (P25 Phase C). Never backfilled for legacy rows -- see this migration''s header.';
comment on column public.appointments.rescheduled_to_id is
  'Successor appointment when this one was rescheduled (P25 Phase C).';
comment on column public.appointments.appt_date is
  'COMPATIBILITY COLUMN, maintained by trigger as coalesce(resolved_on, scheduled_for::date, appt_date). Do not write it directly in new code -- write the three columns above.';

-- ---------------------------------------------------------------------
-- 2. Backfill. Batched, idempotent (`where ... is null`), safe to re-run.
--    Mirrors the rules Phase A already uses so the two agree by
--    construction rather than by coincidence.
-- ---------------------------------------------------------------------
do $$
declare n int;
begin
  loop
    update public.appointments ap
       set set_on = case when ap.import_row_hash is not null
                         then ap.appt_date
                         else (ap.created_at at time zone
                               coalesce(a.time_zone, 'America/New_York'))::date
                    end
      from public.agents a
     where a.id = ap.agent_id
       and ap.set_on is null
       and ap.id in (
         select id from public.appointments where set_on is null limit 5000
       );
    get diagnostics n = row_count;
    exit when n = 0;
    raise notice 'p25b: set_on backfilled for % rows', n;
  end loop;
end $$;

-- scheduled_for: only P23+ rows carry appointment_at, and only while
-- scheduled (F8 nulled it on resolution), so this is legitimately sparse.
update public.appointments
   set scheduled_for = appointment_at
 where scheduled_for is null
   and appointment_at is not null;

-- resolved_on: for a terminal row, appt_date IS the day it was resolved --
-- that is exactly what updateAppointmentStatusAction rewrote it to.
update public.appointments
   set resolved_on = appt_date
 where resolved_on is null
   and status <> 'scheduled';

-- ---------------------------------------------------------------------
-- 3. Coverage gate. set_on becomes NOT NULL only if the backfill reached
--    every row -- a straggler fails the migration loudly here rather than
--    silently later.
-- ---------------------------------------------------------------------
do $$
declare v_missing int;
begin
  select count(*) into v_missing from public.appointments where set_on is null;
  if v_missing > 0 then
    raise exception 'p25b: % appointment row(s) still have a null set_on -- backfill incomplete, refusing to add NOT NULL', v_missing;
  end if;
end $$;

alter table "public"."appointments" alter column "set_on" set not null;

-- ---------------------------------------------------------------------
-- 4. The identity trigger. Keeps set_on immutable, keeps scheduled_for
--    from being destroyed on resolution (F8), derives resolved_on, and
--    maintains appt_date for every existing reader.
--
--    BEFORE INSERT OR UPDATE so it applies to every writer, including the
--    offline replay queue submitting a pre-Phase-B payload (E15).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "private"."appointments_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_tz text;
begin
  select coalesce(a.time_zone, 'America/New_York') into v_tz
  from public.agents a where a.id = new.agent_id;
  v_tz := coalesce(v_tz, 'America/New_York');

  if tg_op = 'INSERT' then
    -- Booked today unless the row is an import, which carries its own date.
    new.set_on := coalesce(
      new.set_on,
      case when new.import_row_hash is not null
           then new.appt_date
           else (coalesce(new.created_at, now()) at time zone v_tz)::date
      end
    );
  else
    -- Rule 1: a privileged column is protected by a trigger, not a policy.
    -- An agent may update their own appointment row; they may not rewrite
    -- when it was booked, because that silently moves a past day's
    -- Appts Set.
    if new.set_on is distinct from old.set_on then
      raise exception 'appointments.set_on is immutable (attempted % -> %)', old.set_on, new.set_on;
    end if;

    -- F8: resolving an appointment must never destroy when it was for.
    -- updateAppointmentAction still nulls appointment_at on a non-scheduled
    -- status; scheduled_for survives that.
    if new.scheduled_for is null and old.scheduled_for is not null then
      new.scheduled_for := old.scheduled_for;
    end if;
  end if;

  -- Dual-write without touching the app: whichever column a writer knows
  -- about, the other one follows.
  if new.scheduled_for is null and new.appointment_at is not null then
    new.scheduled_for := new.appointment_at;
  end if;

  if new.status = 'scheduled' then
    -- Reopening a resolved appointment clears its outcome day.
    new.resolved_on := null;
  else
    new.resolved_on := coalesce(
      new.resolved_on,
      case when tg_op = 'UPDATE' then old.resolved_on end,
      new.appt_date
    );
  end if;

  -- appt_date remains the compatibility column every current reader uses.
  -- coalesce order matters: a resolved appointment counts on the day it was
  -- resolved, a pending one on the day it is for, and anything else keeps
  -- whatever the writer supplied.
  new.appt_date := coalesce(
    new.resolved_on,
    (new.scheduled_for at time zone v_tz)::date,
    new.appt_date,
    new.set_on
  );

  return new;
end $$;

ALTER FUNCTION "private"."appointments_identity"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."appointments_identity"() FROM PUBLIC, "anon", "authenticated";

DROP TRIGGER IF EXISTS "appointments_identity" ON "public"."appointments";
CREATE TRIGGER "appointments_identity"
  BEFORE INSERT OR UPDATE ON "public"."appointments"
  FOR EACH ROW EXECUTE FUNCTION "private"."appointments_identity"();

-- ---------------------------------------------------------------------
-- 5. Cross-agent / cross-org linking guard (E20). A row may only point at
--    a call log or a successor appointment belonging to the same agent,
--    and a reschedule chain may not point at itself (E11).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "private"."appointments_links_valid"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.source_call_log_id is not null then
    if not exists (
      select 1 from public.call_logs cl
      where cl.id = new.source_call_log_id
        and cl.agent_id = new.agent_id
        and cl.org_id = new.org_id
    ) then
      raise exception 'appointments.source_call_log_id must reference a call log belonging to the same agent and org';
    end if;
  end if;

  if new.rescheduled_to_id is not null then
    if new.rescheduled_to_id = new.id then
      raise exception 'appointments.rescheduled_to_id cannot point at itself';
    end if;
    if not exists (
      select 1 from public.appointments ap
      where ap.id = new.rescheduled_to_id
        and ap.agent_id = new.agent_id
        and ap.org_id = new.org_id
    ) then
      raise exception 'appointments.rescheduled_to_id must reference an appointment belonging to the same agent and org';
    end if;
  end if;

  return new;
end $$;

ALTER FUNCTION "private"."appointments_links_valid"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."appointments_links_valid"() FROM PUBLIC, "anon", "authenticated";

DROP TRIGGER IF EXISTS "appointments_links_valid" ON "public"."appointments";
CREATE TRIGGER "appointments_links_valid"
  BEFORE INSERT OR UPDATE OF "source_call_log_id", "rescheduled_to_id"
  ON "public"."appointments"
  FOR EACH ROW EXECUTE FUNCTION "private"."appointments_links_valid"();

-- ---------------------------------------------------------------------
-- 6. Indexes. Plain CREATE INDEX, not CONCURRENTLY: that cannot run inside
--    a migration's transaction, and at this table's size (tens of rows) the
--    lock is immeasurable.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "appointments_agent_set_on_idx"
  ON "public"."appointments" USING "btree" ("agent_id", "set_on");

CREATE INDEX IF NOT EXISTS "appointments_agent_scheduled_for_idx"
  ON "public"."appointments" USING "btree" ("agent_id", "scheduled_for")
  WHERE ("status" = 'scheduled'::"public"."appt_status");

CREATE INDEX IF NOT EXISTS "appointments_source_call_log_idx"
  ON "public"."appointments" USING "btree" ("source_call_log_id")
  WHERE ("source_call_log_id" IS NOT NULL);

-- ---------------------------------------------------------------------
-- 7. enqueue_metrics: the booking day is now a column, not a derivation.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."enqueue_metrics"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare d_old date; d_new date; s_old date; s_new date;
begin
  -- F2 (Phase A): set only by private.purge_old_call_logs(), for its own
  -- transaction. Retention deletes raw rows on purpose; it must not also
  -- rewrite the aggregate that outlives them.
  if coalesce(current_setting('kautis.purging', true), '') = 'on' then
    return null;
  end if;

  if tg_table_name = 'call_logs' then
    d_old := (case when tg_op <> 'INSERT' then old.call_date end);
    d_new := (case when tg_op <> 'DELETE' then new.call_date end);
  elsif tg_table_name = 'appointments' then
    d_old := (case when tg_op <> 'INSERT' then old.appt_date end);
    d_new := (case when tg_op <> 'DELETE' then new.appt_date end);
    -- appts_set counts on the booking day, which differs from appt_date
    -- whenever an appointment is booked for a later date. No time-zone
    -- arithmetic needed any more: set_on is stored.
    s_old := (case when tg_op <> 'INSERT' then old.set_on end);
    s_new := (case when tg_op <> 'DELETE' then new.set_on end);
  elsif tg_table_name = 'sales' then
    d_old := (case when tg_op <> 'INSERT' then old.sale_date end);
    d_new := (case when tg_op <> 'DELETE' then new.sale_date end);
  else
    d_old := (case when tg_op <> 'INSERT' then old.log_date end);
    d_new := (case when tg_op <> 'DELETE' then new.log_date end);
  end if;

  if tg_op <> 'INSERT' then perform private.mark_dirty(old.agent_id, d_old); end if;
  if tg_op <> 'DELETE' then perform private.mark_dirty(new.agent_id, d_new); end if;
  if s_old is not null then perform private.mark_dirty(old.agent_id, s_old); end if;
  if s_new is not null then perform private.mark_dirty(new.agent_id, s_new); end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 8. recompute_day: appts_set reads set_on, and the F4 dedup clause lands
--    (inert until Phase C populates source_call_log_id). Everything else
--    is byte-identical to Phase A -- see WHAT DOES NOT CHANGE above.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "private"."recompute_day"("p_agent" "uuid", "p_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_org uuid;
begin
  select a.org_id into v_org from public.agents a where a.id = p_agent;
  if v_org is null then
    delete from public.daily_metrics where agent_id = p_agent and activity_date = p_date;
    return;
  end if;

  insert into public.daily_metrics as m (
    agent_id, org_id, activity_date,
    calls_made, appts_set, referrals_given, recruiting_convos, sales_count, premium_cents,
    follow_ups_due, follow_ups_done,
    out_connected, out_voicemail, out_no_answer, out_appt_set, out_not_interested,
    src_warm_market, src_referral, src_cold, src_social_media, src_friend, src_other,
    src_existing_client, src_existing_recruit,
    appt_scheduled, appt_held, appt_no_show, appt_rescheduled, appt_cancelled, updated_at
  )
  select p_agent, v_org, p_date,
    coalesce(c.n,0), coalesce(c.appt_set_unlinked,0) + coalesce(apset.n,0), coalesce(ap.refs,0), coalesce(rc.n,0),
    coalesce(s.n,0), coalesce(s.prem,0),
    coalesce(fu.due,0), coalesce(fu.done,0),
    coalesce(c.connected,0), coalesce(c.voicemail,0), coalesce(c.no_answer,0),
    coalesce(c.appt_set,0), coalesce(c.not_int,0),
    coalesce(c.warm,0), coalesce(c.refr,0), coalesce(c.cold,0),
    coalesce(c.social,0), coalesce(c.friend,0), coalesce(c.other,0),
    coalesce(c.exist_client,0), coalesce(c.exist_recruit,0),
    coalesce(ap.sched,0), coalesce(ap.held,0), coalesce(ap.noshow,0),
    coalesce(ap.resched,0), coalesce(ap.cancel,0), now()
  from (select 1) z
  left join lateral (
    select count(*) n,
      count(*) filter (where outcome='connected')        connected,
      count(*) filter (where outcome='voicemail')        voicemail,
      count(*) filter (where outcome='no_answer')        no_answer,
      count(*) filter (where outcome='appointment_set')  appt_set,
      -- F4: a call that produced an appointment row is counted through that
      -- row, not twice. Inert until Phase C sets source_call_log_id.
      -- out_appt_set above stays the raw call-outcome count; only the
      -- appts_set contribution is deduped.
      count(*) filter (
        where outcome='appointment_set'
          and not exists (
            select 1 from public.appointments ap2
            where ap2.source_call_log_id = call_logs.id
          )
      ) appt_set_unlinked,
      count(*) filter (where outcome='not_interested')   not_int,
      count(*) filter (where source='warm_market')       warm,
      count(*) filter (where source='referral')          refr,
      count(*) filter (where source='cold')              cold,
      count(*) filter (where source='social_media')      social,
      count(*) filter (where source='friend')            friend,
      count(*) filter (where source='other')             other,
      count(*) filter (where source='existing_client')   exist_client,
      count(*) filter (where source='existing_recruit')  exist_recruit
    from public.call_logs where agent_id=p_agent and call_date=p_date
  ) c on true
  left join lateral (
    -- Status counts stay on appt_date. The identity trigger keeps
    -- appt_date = resolved_on for every terminal row, so this is the same
    -- number either way, with one fewer thing changing in this migration.
    select coalesce(sum(referrals_given),0) refs,
      count(*) filter (where status='scheduled')   sched,
      count(*) filter (where status='held')        held,
      count(*) filter (where status='no_show')     noshow,
      count(*) filter (where status='rescheduled') resched,
      count(*) filter (where status='cancelled')   cancel
    from public.appointments where agent_id=p_agent and appt_date=p_date
  ) ap on true
  left join lateral (
    -- The booking event, whatever the appointment later became (F3).
    -- Phase A derived this day with a case expression; it is a stored,
    -- immutable column now, so an agent changing their time zone can no
    -- longer move a past day's Appts Set (E3).
    select count(*) n
    from public.appointments
    where agent_id = p_agent and set_on = p_date
  ) apset on true
  left join lateral (
    select count(*) n, coalesce(sum(premium_cents),0) prem
    from public.sales where agent_id=p_agent and sale_date=p_date
  ) s on true
  left join lateral (
    select count(*) n from public.recruiting_logs
    where agent_id=p_agent and log_date=p_date
  ) rc on true
  left join lateral (
    select count(*) filter (where follow_up_on=p_date) due,
           count(*) filter (where follow_up_on=p_date and follow_up_done_at is not null) done
    from public.call_logs where agent_id=p_agent
  ) fu on true
  on conflict (agent_id, activity_date) do update set
    calls_made=excluded.calls_made, appts_set=excluded.appts_set,
    referrals_given=excluded.referrals_given, recruiting_convos=excluded.recruiting_convos,
    sales_count=excluded.sales_count, premium_cents=excluded.premium_cents,
    follow_ups_due=excluded.follow_ups_due, follow_ups_done=excluded.follow_ups_done,
    out_connected=excluded.out_connected, out_voicemail=excluded.out_voicemail,
    out_no_answer=excluded.out_no_answer, out_appt_set=excluded.out_appt_set,
    out_not_interested=excluded.out_not_interested,
    src_warm_market=excluded.src_warm_market, src_referral=excluded.src_referral,
    src_cold=excluded.src_cold, src_social_media=excluded.src_social_media,
    src_friend=excluded.src_friend, src_other=excluded.src_other,
    src_existing_client=excluded.src_existing_client, src_existing_recruit=excluded.src_existing_recruit,
    appt_scheduled=excluded.appt_scheduled, appt_held=excluded.appt_held,
    appt_no_show=excluded.appt_no_show, appt_rescheduled=excluded.appt_rescheduled,
    appt_cancelled=excluded.appt_cancelled, updated_at=now();

  -- F1 (Phase A): drop the row only when EVERY counter is zero, driven off
  -- the row's own shape so a column added later is covered automatically.
  delete from public.daily_metrics d
  where d.agent_id = p_agent
    and d.activity_date = p_date
    and not exists (
      select 1
      from jsonb_each(to_jsonb(d)) as kv(key, value)
      where kv.key not in ('agent_id', 'org_id', 'activity_date', 'updated_at')
        and jsonb_typeof(kv.value) = 'number'
        and (kv.value #>> '{}')::numeric <> 0
    );
end $$;

-- ---------------------------------------------------------------------
-- 9. Rebuild. set_on is now a stored column rather than a derived
--    expression; for every existing row it resolves to the same day Phase A
--    computed, so this should be a no-op -- but it is re-driven anyway so
--    that is PROVEN rather than assumed. Same mechanism as Phase A: mark
--    dirty, let drain_metrics recompute through recompute_day itself.
-- ---------------------------------------------------------------------
insert into private.metrics_dirty (agent_id, activity_date)
select agent_id, activity_date from public.daily_metrics
on conflict do nothing;

insert into private.metrics_dirty (agent_id, activity_date)
select agent_id, set_on from public.appointments
on conflict do nothing;

insert into private.metrics_dirty (agent_id, activity_date)
select agent_id, appt_date from public.appointments
on conflict do nothing;

insert into private.metrics_dirty (agent_id, activity_date)
select agent_id, call_date from public.call_logs where outcome = 'appointment_set'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- MEASURING THE LEGACY F4 DOUBLE COUNT (read-only, run when you want it)
--
-- How many historical call logs look like they describe an appointment
-- that also has its own row? Run this before deciding whether the legacy
-- double count is worth a retro-link migration and a second announcement:
--
--   select cl.agent_id, cl.call_date, count(*) as likely_duplicates
--   from public.call_logs cl
--   join public.appointments ap
--     on ap.agent_id = cl.agent_id
--    and ap.contact_id = cl.contact_id
--    and ap.scheduled_for is not distinct from cl.appointment_at
--   where cl.outcome = 'appointment_set'
--     and cl.appointment_at is not null
--     and ap.source_call_log_id is null
--   group by cl.agent_id, cl.call_date
--   order by likely_duplicates desc;
--
-- Zero rows means the legacy double count is theoretical and Phase C
-- closes F4 completely with no restatement needed.
-- ---------------------------------------------------------------------
