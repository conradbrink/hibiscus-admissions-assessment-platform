-- The two orientation functions, revoked from anon as well.
--
-- `20260912210000_staff_orientation.sql` revoked them from `public` and
-- granted `authenticated`, which reads as enough and is not: Supabase's own
-- default privileges hand `anon` execute on a function created here, and a
-- revoke from `public` does not take a grant away from a named role. So both
-- were the only functions in this schema an unauthenticated caller could
-- execute — every other one in the project revokes `public, anon,
-- authenticated` in the same breath, which is the convention this should have
-- followed.
--
-- Nothing was reachable through them: both read `auth.uid()` first and raise
-- `not_signed_in` when there is none, so an anonymous call did nothing but
-- raise. This is the layer that should not have been depending on the layer
-- above it.

revoke all on function public.mark_orientation_read(text, boolean) from public, anon;
revoke all on function public.reset_orientation() from public, anon;

grant execute on function public.mark_orientation_read(text, boolean) to authenticated;
grant execute on function public.reset_orientation() to authenticated;
