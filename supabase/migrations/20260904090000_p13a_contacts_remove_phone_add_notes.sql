-- Product reversal: phone capture on contacts (p9a) is removed again --
-- agents should not be asked for, shown, or store a contact's phone number
-- anywhere (manual add, device import, or Excel import). Existing phone
-- data is dropped along with the column, not just hidden from the UI.
--
-- In its place, contacts gain a free-text `notes` field captured at
-- creation time (Add contact dialog) and searchable from /contacts search,
-- same as call/appointment/sale notes elsewhere in the schema.

drop index if exists public.contacts_agent_phone_uq;
alter table public.contacts drop column if exists phone_normalized;
alter table public.contacts drop column if exists phone;

alter table public.contacts add column notes text;
