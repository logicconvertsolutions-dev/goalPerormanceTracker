-- Offline queue idempotency: a client-generated UUID per logged action, so a
-- retried submission (network dropped after the server saved it, client
-- retries once back online) never double-inserts. Distinct from
-- import_row_hash (which dedupes spreadsheet import rows) — this dedupes
-- direct create actions. Same partial-unique-index shape as import_row_hash;
-- the app layer must insert (never upsert with onConflict against a partial
-- index — Postgres rejects that, see src/lib/import/commit-import.ts) and
-- treat a 23505 unique-violation as "already saved, not an error".
alter table public.call_logs add column client_request_id text;
create unique index call_logs_client_request_uq on public.call_logs (agent_id, client_request_id)
  where client_request_id is not null;

alter table public.appointments add column client_request_id text;
create unique index appointments_client_request_uq on public.appointments (agent_id, client_request_id)
  where client_request_id is not null;

alter table public.sales add column client_request_id text;
create unique index sales_client_request_uq on public.sales (agent_id, client_request_id)
  where client_request_id is not null;

alter table public.recruiting_logs add column client_request_id text;
create unique index recruiting_client_request_uq on public.recruiting_logs (agent_id, client_request_id)
  where client_request_id is not null;
