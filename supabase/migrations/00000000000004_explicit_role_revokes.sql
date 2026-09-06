-- REVOKE ALL ... FROM PUBLIC does not undo a direct grant made via
-- ALTER DEFAULT PRIVILEGES ... TO anon/authenticated (that's a named-role
-- grant, not inherited via PUBLIC membership). Naming the roles explicitly
-- here is correct regardless of default-privilege timing or ordering.

REVOKE ALL ON FUNCTION "public"."admin_daily_active_loggers"("p_days" integer) FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."system_effective_target"("p_agent_id" "uuid", "p_period_start" "date") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") FROM "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."pgmq_read"("queue_name" "text", "vt" integer, "qty" integer) FROM "anon", "authenticated";

REVOKE ALL ON TABLE "public"."notification_log" FROM "anon", "authenticated";
