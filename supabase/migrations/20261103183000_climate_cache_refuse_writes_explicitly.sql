-- Say no out loud, like the other shared tables do.
--
-- climate_cache already refused client updates and deletes -- RLS is on and no
-- policy grants them, so Postgres denies by default. But bike_systems,
-- stations and worker_runs all carry explicit "Nobody may ..." policies,
-- precisely so that a reviewer reading pg_policies sees a decision rather than
-- a gap. This table was the one place the refusal was invisible, which is the
-- exact shape of oversight AGENTS.md says /security-review should catch.
--
-- No behaviour changes. The service role bypasses RLS, so the server's cache
-- write in app/api/climate/route.ts is unaffected.

create policy "Clients may not change cached climate"
  on public.climate_cache for update to authenticated using (false);

create policy "Clients may not remove cached climate"
  on public.climate_cache for delete to authenticated using (false);
