-- Product decision: self-service "Delete my account" (p6b) is removed from
-- /settings for all users. No other RPC, policy, or trigger calls this
-- function (confirmed by search of the codebase) -- safe to drop outright
-- rather than just hiding its button.
drop function if exists public.delete_my_account();
