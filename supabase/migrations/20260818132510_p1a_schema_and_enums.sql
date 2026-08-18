-- Private schema for helper functions. MUST NOT be added to Exposed Schemas.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create type public.agent_role as enum ('associate','leader','admin');
create type public.agent_status as enum ('active','inactive');

create type public.call_source as enum
  ('warm_market','referral','cold','social_media','friend','other');
create type public.call_outcome as enum
  ('connected','voicemail','no_answer','appointment_set','not_interested');
create type public.appt_status as enum
  ('scheduled','held','no_show','rescheduled','cancelled');
create type public.recruit_status as enum
  ('contacted','interviewed','joined','licensed','declined');
