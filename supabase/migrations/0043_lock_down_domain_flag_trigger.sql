-- Applied via the Supabase MCP on 2026-07-31.
-- A trigger function is only ever invoked by the trigger, never called directly, so leaving it
-- EXECUTE-able by anon/authenticated is surface with no purpose (flagged by get_advisors as
-- anon_security_definer_function_executable). Triggers still fire regardless of these grants.
revoke execute on function public.clear_domain_flags_when_unverified() from public, anon, authenticated;
