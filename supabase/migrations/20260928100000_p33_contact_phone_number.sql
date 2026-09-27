-- P33: an optional phone number on a contact, for tap-to-call and the
-- WhatsApp handoff (P33) and call tracking (P34).
--
-- This reverses P13a's "phone numbers are structurally uncollectable"
-- decision (04-security.md, Privacy) at the product owner's request. What
-- keeps it inside the privacy promise:
--   * contacts is already owner-only under RLS (policy contacts_own:
--     agent_id = auth.uid()). No leader, admin or other-org user can select
--     a contact row, so none can read this column. pgTAP 014 proves it.
--   * no SECURITY DEFINER function may read it: the team/leader/admin RPCs
--     return counts only (rule 2). pgTAP 014 also fails if any definer
--     function in public/private ever mentions phone_number.
--   * it goes with the contact: contact delete, admin_hard_delete_agent and
--     the agent FK cascade all remove the row, number included.
--   * the privacy notice (/privacy) was rewritten in the same phase to say
--     so, and the terms version was bumped so every user re-accepts.
--
-- Stored in E.164 (+<country code><number>, 8-15 digits) only: WhatsApp's
-- wa.me handoff needs the country code, and one format means one way to
-- compare numbers. The app normalises input before it gets here; the check
-- constraint is the backstop.
--
-- Re-runnable (CLAUDE.md "Dumped SQL is not automatically safe to re-run").

alter table "public"."contacts" add column if not exists "phone_number" text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contacts_phone_number_e164'
      and conrelid = 'public.contacts'::regclass
  ) then
    alter table "public"."contacts"
      add constraint "contacts_phone_number_e164"
      check ("phone_number" is null or "phone_number" ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end $$;

comment on column "public"."contacts"."phone_number" is
  'Optional, E.164 (+15551234567). Owner-only via RLS; never returned by any leader/admin RPC (P33).';
