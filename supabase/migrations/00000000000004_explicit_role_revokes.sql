-- REVOKE ALL ... FROM PUBLIC does not undo a direct grant made via
-- ALTER DEFAULT PRIVILEGES ... TO anon/authenticated (that's a named-role
-- grant, not inherited via PUBLIC membership). Naming the roles explicitly
-- here is correct regardless of default-privilege timing or ordering.
--
-- Production is currently fine for all of these (verified via
-- has_function_privilege/has_table_privilege against the live project) --
-- this migration exists to close the same latent gap on any FUTURE fresh
-- build (a new branch, disaster recovery, a new dev environment), where a
-- database's own bootstrap default-privileges rule would otherwise leak
-- access to anon/authenticated on every one of these before this file's
-- own [remotes]-declared default-privileges rule (later in the baseline)
-- ever takes effect.

-- Service-role-only functions
REVOKE ALL ON FUNCTION "public"."admin_create_announcement"("p_actor_id" "uuid", "p_message" "text") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_daily_active_loggers"("p_days" integer) FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_delete_org"("p_actor_id" "uuid", "p_org_id" "uuid") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_hard_delete_agent"("p_actor_id" "uuid", "p_agent_id" "uuid") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_move_agent"("p_actor_id" "uuid", "p_agent_id" "uuid", "p_new_upline_id" "uuid") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_reactivate_agent"("p_actor_id" "uuid", "p_agent_id" "uuid") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_set_agent_role"("p_actor_id" "uuid", "p_agent_id" "uuid", "p_role" "public"."agent_role", "p_org_id" "uuid") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."admin_set_announcement_active"("p_actor_id" "uuid", "p_announcement_id" "uuid", "p_active" boolean) FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."audit_target_change"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."closure_on_insert"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."closure_on_move"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."drain_metrics"("p_limit" integer) FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."enforce_same_org"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."enqueue_metrics"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."guard_agent_privileged_columns"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."pgmq_archive"("queue_name" "text", "msg_id" bigint) FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."pgmq_delete"("queue_name" "text", "msg_id" bigint) FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."pgmq_read"("queue_name" "text", "vt" integer, "qty" integer) FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."provision_org"("p_org_name" "text", "p_smd_email" "text", "p_smd_name" "text") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."set_org_from_agent"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."set_org_from_agent_nullable"() FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."system_effective_target"("p_agent_id" "uuid", "p_period_start" "date") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") FROM "anon", "authenticated";

-- Service-role-only tables (no RLS policies defined -- access is
-- grant-only, so these must not leak via default privileges either)
REVOKE ALL ON TABLE "public"."agent_auto_nudge_log" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."agent_email_changes" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."agent_nudges" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."agent_training_reminders" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."notification_log" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."team_roster_reminder_log" FROM "anon", "authenticated";