-- ============================================================================
-- DATABASE SCHEMA V35 MIGRATION — PRIVATE ACCESS LOCKDOWN (Row-Level Security)
-- ----------------------------------------------------------------------------
-- Purpose: make the system private. Turn on Row-Level Security for EVERY table
--          in the public schema and allow access ONLY to authenticated users.
--          Anonymous requests (anyone using the public API key WITHOUT logging
--          in) are denied by default once RLS is enabled with no anon policy.
--
-- Single-tenant: there is one login (the owner), so any authenticated user
-- gets full access (USING true / WITH CHECK true). If separate users are ever
-- added and their data must be isolated, replace `true` with an ownership
-- check (e.g. USING (owner_id = auth.uid())).
--
-- ⚠ RUN THIS LAST. Correct order to avoid locking yourself out:
--   1. Supabase → Authentication → Users → Add user (your email + password),
--      and disable public sign-ups (Authentication → Providers/Sign In).
--   2. Deploy the app with the new login screen; confirm you can sign in.
--   3. THEN run this migration here in Supabase → SQL Editor.
-- After this runs, the app only works while signed in.
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_full_access" ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY "authenticated_full_access" ON public.%I '
      'FOR ALL TO authenticated USING (true) WITH CHECK (true);', t
    );
  END LOOP;
END $$;

-- Verification: every public table should show rls_enabled = true and carry
-- exactly one policy named "authenticated_full_access".
SELECT c.relname            AS table_name,
       c.relrowsecurity     AS rls_enabled,
       p.polname            AS policy_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
