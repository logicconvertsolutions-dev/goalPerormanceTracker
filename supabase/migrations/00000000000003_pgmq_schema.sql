


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "pgmq";


ALTER SCHEMA "pgmq" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "pgmq"."a_notification_sends" (
    "msg_id" bigint NOT NULL,
    "read_ct" integer DEFAULT 0 NOT NULL,
    "enqueued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vt" timestamp with time zone NOT NULL,
    "message" "jsonb",
    "headers" "jsonb"
);


ALTER TABLE "pgmq"."a_notification_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "pgmq"."q_notification_sends" (
    "msg_id" bigint NOT NULL,
    "read_ct" integer DEFAULT 0 NOT NULL,
    "enqueued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vt" timestamp with time zone NOT NULL,
    "message" "jsonb",
    "headers" "jsonb"
);


ALTER TABLE "pgmq"."q_notification_sends" OWNER TO "postgres";


ALTER TABLE "pgmq"."q_notification_sends" ALTER COLUMN "msg_id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "pgmq"."q_notification_sends_msg_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "pgmq"."a_notification_sends"
    ADD CONSTRAINT "a_notification_sends_pkey" PRIMARY KEY ("msg_id");



ALTER TABLE ONLY "pgmq"."q_notification_sends"
    ADD CONSTRAINT "q_notification_sends_pkey" PRIMARY KEY ("msg_id");



CREATE INDEX "archived_at_idx_notification_sends" ON "pgmq"."a_notification_sends" USING "btree" ("archived_at");



CREATE INDEX "q_notification_sends_vt_idx" ON "pgmq"."q_notification_sends" USING "btree" ("vt");



GRANT SELECT ON TABLE "pgmq"."a_notification_sends" TO "pg_monitor";



GRANT SELECT ON TABLE "pgmq"."q_notification_sends" TO "pg_monitor";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "pgmq" GRANT SELECT ON SEQUENCES TO "pg_monitor";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "pgmq" GRANT SELECT ON TABLES TO "pg_monitor";





CREATE EXTENSION IF NOT EXISTS "pgmq" WITH SCHEMA "pgmq" VERSION '1.5.1';