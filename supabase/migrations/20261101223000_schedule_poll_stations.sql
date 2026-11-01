-- Wake the worker every 30 seconds.
--
-- Thirty rather than ten, and the arithmetic is the argument. Divvy's feed
-- advertises ttl: 60, so it only republishes once a minute -- polling faster
-- re-reads bytes we already have. Thirty seconds means two polls per refresh
-- window, so a change is visible within about half a window, at 86,400
-- invocations a month against a 500,000 allowance.
--
-- Watched before scheduling, with 100 Chicago stations followed:
--   run 1, cold            100 rows written (every followed station was new)
--   run 2, immediately     0 rows   (feed had not refreshed -- nothing changed)
--   run 3, after 70s       3 rows   (3% of 100, against the 3.5% measured
--                                    across 2,078 stations earlier)
-- Run 2 returning zero is the whole design working: a poll that finds nothing
-- new writes nothing and spends no Realtime messages.
--
-- The call carries the project's *anon* key, not the service role key. The anon
-- key is public by design -- it ships to every browser -- so it is safe in a
-- migration, and it satisfies the function's verify_jwt. The worker's actual
-- power comes from the service role key that Supabase injects into it on its
-- own servers, which is never in this repository.
--
-- Accepted knowingly: anyone holding that public key can invoke the worker and
-- burn Edge Function quota. They cannot read or write anything they could not
-- already, because the function takes no user input beyond a system slug that
-- must already exist in bike_systems. The hardening step, if it matters later,
-- is a shared secret in Vault checked inside the function.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'poll-stations',
  '30 seconds',
  $$
  select net.http_post(
    url     := 'https://sqxtvbwkohmwomkxilwf.supabase.co/functions/v1/poll-stations',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <anon key — see the live project; public by design>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
