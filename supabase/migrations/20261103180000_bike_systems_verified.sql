-- Make the catalogue say which cities actually work, and when that was checked.
--
-- `bike_systems` started as rows typed by hand, then grew rows found on demand
-- by /api/find-system. Neither answers the question the destination field now
-- has to ask before a trip exists: *which cities can this app serve at all?*
-- The registry cannot answer it either -- it lists 1,277 systems, and most of
-- them are free-floating fleets, dead deployments or feeds that refuse us.
--
-- So the catalogue carries the answer. `scripts/verify-systems.mjs` probes
-- every registry entry end to end and stamps `verified_at` on the ones that
-- pass; `/api/cities` offers exactly those.
--
-- `verified_at` is nullable and cleared rather than deleted on purpose. A
-- system whose bikes have gone -- Denver's, shut down in 2020 -- stops being
-- offered, but its row and the 119 stations referencing it stay. Dropping it
-- would be a destructive migration against somebody's trip history, and the
-- fence we want is "don't offer it", not "pretend it never existed".

alter table public.bike_systems
  add column region        text,
  add column country       text,
  add column station_count integer,
  add column verified_at   timestamptz;

-- The destination picker reads this on every keystroke, so it gets an index
-- rather than a sequential scan over the catalogue.
create index bike_systems_verified_idx
  on public.bike_systems (verified_at)
  where verified_at is not null;

comment on column public.bike_systems.verified_at is
  'Last time scripts/verify-systems.mjs saw this feed serve a bike from a dock '
  'and the city name geocode to within 100km of its stations. Null means do '
  'not offer this city as a destination.';
