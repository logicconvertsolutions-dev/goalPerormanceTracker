-- audit_target_insert is a trigger function, never meant to be called
-- directly -- it defaulted to PUBLIC EXECUTE like every SECURITY DEFINER
-- function does unless explicitly revoked (same reason p1l revoked the
-- whole schema once). Triggers don't need EXECUTE granted to fire; only
-- direct RPC callers do.
revoke all on function public.audit_target_insert() from public, anon, authenticated;
