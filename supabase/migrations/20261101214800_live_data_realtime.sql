-- The live layer, part four: let Realtime push these two tables.
--
-- Realtime needs three things, and this migration is only one of them:
--
--   1. the table in the supabase_realtime publication   <- this file
--   2. read access granted to the role                  <- the select policies
--   3. an RLS policy that lets the person read the row  <- same policies
--
-- If any one is missing the page gets nothing, with no error anywhere. That
-- silence is the single most expensive thing about this feature, so when
-- updates don't arrive, check all three before debugging the client.

alter publication supabase_realtime add table public.stations;

-- worker_runs too, so the page can move itself from "fresh" to "down" the
-- moment a run fails, rather than waiting for a poll it would otherwise have
-- to do itself. A failing worker is exactly when you don't want the page
-- quietly showing numbers as though they were live.
alter publication supabase_realtime add table public.worker_runs;

-- station_follows is deliberately NOT published. A person's own choices only
-- change when they themselves change them, in a browser that already knows it
-- did -- there is nothing to push. Publishing it would spend Realtime
-- messages to tell someone what they just told us.
--
-- bike_systems is not published either: it changes when a migration adds a
-- city, which is a deploy, not a live event.
