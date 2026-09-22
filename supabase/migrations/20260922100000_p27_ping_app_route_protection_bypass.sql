-- P27: let private.ping_app_route() through Vercel Deployment Protection.
--
-- pg_cron's pings (ping_notification_drain, ping_legacy_notifications) POST
-- to the app via pg_net. On staging that POST never reaches Next.js: Vercel
-- Authentication rejects it at the edge with a 401 whose body is
--
--   {"protection":{"vercel_auth_enabled":true,"vercel_auth_callback":
--    "https://vercel.com/sso-api?url=https%3A%2F%2Fstaging.kautis.ca%2F..."}}
--
-- so the notification queue simply accumulated -- 38 messages between
-- 2026-09-07 and 2026-09-21, every one at read_ct = 0, never once read by a
-- drain. The project's ssoProtection is `all_except_custom_domains`, and
-- staging.kautis.ca IS a correctly configured custom domain, but that
-- exemption only covers PRODUCTION custom domains; one attached to the
-- Preview environment is still challenged. Production (kautis.ca) is exempt,
-- which is why this was invisible there.
--
-- Vercel's supported escape hatch for machine callers is Protection Bypass
-- for Automation: a generated secret sent as the x-vercel-protection-bypass
-- header. This reads it from a third Vault secret, `vercel_bypass_secret`,
-- and adds the header only when that secret exists -- so production, which
-- needs no bypass, keeps sending exactly the two headers it sends today and
-- is unaffected by this migration.
--
-- Built from pg_get_functiondef() of the live function, not from
-- 00000000000000_baseline.sql (the two agree here, but see P26's note --
-- the baseline is stale for anything a later migration redefined).

CREATE OR REPLACE FUNCTION "private"."ping_app_route"("p_path" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_base_url text;
  v_secret text;
  v_bypass text;
  v_headers jsonb;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_base_url is null or v_secret is null or v_base_url = '' or v_secret = '' then
    raise notice '[notifications] app_base_url/cron_secret not configured in Vault -- skipping ping to %', p_path;
    return;
  end if;

  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_secret,
    'Content-Type', 'application/json'
  );

  -- Optional, and absent in production on purpose: only an environment
  -- sitting behind Vercel Authentication needs it.
  select decrypted_secret into v_bypass from vault.decrypted_secrets where name = 'vercel_bypass_secret';
  if v_bypass is not null and v_bypass <> '' then
    v_headers := v_headers || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;

  perform net.http_post(
    url := v_base_url || p_path,
    headers := v_headers,
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $$;

ALTER FUNCTION "private"."ping_app_route"("p_path" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "private"."ping_app_route"("p_path" "text") FROM PUBLIC, "anon", "authenticated";
