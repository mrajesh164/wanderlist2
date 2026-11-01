-- The live layer, part three: the record of every run.
--
-- The brief asks the worker to record each run, and the page needs it for a
-- reason worth stating: *stale* and *down* are different failures and must not
-- look the same. Old numbers because the pipe is slow is not the same as old
-- numbers because the worker is throwing. Without this table the page can see
-- that stations.updated_at is old but cannot tell you which.
--
-- Shared and read-only like the other two: it holds nobody's data, and every
-- signed-in person needs to read it to know whether what they're looking at
-- is live.

create table public.worker_runs (
  id             uuid primary key default gen_random_uuid(),

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,

  ok             boolean not null,

  systems_polled integer not null default 0,

  -- The number the whole upsert argument rests on. Two calls 120s apart found
  -- 72 of Chicago's 2078 stations had changed -- 3.5% -- so a run that writes
  -- thousands of rows means the "only what changed" comparison has broken,
  -- and a month of Realtime messages is about to go with it. Recording the
  -- count is what makes that claim checkable instead of rhetorical.
  rows_changed   integer not null default 0,

  -- Null when ok. The message, not a stack trace -- this is read by a page,
  -- not a debugger.
  error          text,

  constraint worker_runs_error_matches_ok check (ok or error is not null)
);

-- The page's hottest query is "the most recent run", and after that "the most
-- recent run that succeeded". Both walk this index backwards.
create index worker_runs_recent on public.worker_runs (started_at desc);

alter table public.worker_runs enable row level security;

create policy "Signed-in users may read worker runs"
  on public.worker_runs for select
  to authenticated
  using (true);

create policy "Clients may not record runs"
  on public.worker_runs for insert to authenticated with check (false);
create policy "Clients may not change runs"
  on public.worker_runs for update to authenticated using (false);
create policy "Clients may not delete runs"
  on public.worker_runs for delete to authenticated using (false);
