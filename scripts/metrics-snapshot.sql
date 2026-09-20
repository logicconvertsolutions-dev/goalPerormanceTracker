-- daily_metrics snapshot — the before/after artifact for any migration that
-- redefines a metric or backfills the read model (P25 Phase A and B; see
-- `.github/Spec Sheets/12-appointment-lifecycle-remediation.md` §6).
--
-- USAGE
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --csv -f scripts/metrics-snapshot.sql \
--     > snapshot-before.csv
--   ...apply the migration, let drain-metrics finish (see §6 step 3)...
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --csv -f scripts/metrics-snapshot.sql \
--     > snapshot-after.csv
--   diff -u snapshot-before.csv snapshot-after.csv
--
-- Attach the diff to the PR. A migration that redefines a metric MUST show
-- its effect here before it is promoted past `staging`.
--
-- Contains no prospect PII by construction: daily_metrics holds counts only,
-- and this aggregates further to agent-month. Safe to attach to a PR.
--
-- Deterministic ordering so `diff` is meaningful rather than noise.

select
  m.agent_id,
  a.org_id,
  to_char(m.activity_date, 'YYYY-MM')      as month,
  count(*)                                 as days_with_rows,
  sum(m.calls_made)                        as calls_made,
  sum(m.appts_set)                         as appts_set,
  sum(m.referrals_given)                   as referrals_given,
  sum(m.recruiting_convos)                 as recruiting_convos,
  sum(m.sales_count)                       as sales_count,
  sum(m.premium_cents)                     as premium_cents,
  sum(m.follow_ups_due)                    as follow_ups_due,
  sum(m.follow_ups_done)                   as follow_ups_done,
  sum(m.out_connected)                     as out_connected,
  sum(m.out_voicemail)                     as out_voicemail,
  sum(m.out_no_answer)                     as out_no_answer,
  sum(m.out_appt_set)                      as out_appt_set,
  sum(m.out_not_interested)                as out_not_interested,
  sum(m.src_warm_market)                   as src_warm_market,
  sum(m.src_referral)                      as src_referral,
  sum(m.src_cold)                          as src_cold,
  sum(m.src_social_media)                  as src_social_media,
  sum(m.src_friend)                        as src_friend,
  sum(m.src_other)                         as src_other,
  sum(m.src_existing_client)               as src_existing_client,
  sum(m.src_existing_recruit)              as src_existing_recruit,
  sum(m.appt_scheduled)                    as appt_scheduled,
  sum(m.appt_held)                         as appt_held,
  sum(m.appt_no_show)                      as appt_no_show,
  sum(m.appt_rescheduled)                  as appt_rescheduled,
  sum(m.appt_cancelled)                    as appt_cancelled
from public.daily_metrics m
join public.agents a on a.id = m.agent_id
group by m.agent_id, a.org_id, to_char(m.activity_date, 'YYYY-MM')
order by a.org_id, m.agent_id, month;
