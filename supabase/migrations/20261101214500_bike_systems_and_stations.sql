-- The live layer, part one: what we poll, and what we store from it.
--
-- Two tables, both shared and owned by nobody, in the same spirit as
-- climate_cache: station availability in Chicago is identical for every user
-- on the planet, so one fetch should serve everybody. Neither table has a
-- user_id, and neither is writable by a client -- only the worker, holding the
-- service role key that Supabase supplies on its own servers, fills them.

-- ---------------------------------------------------------------------------
-- bike_systems: the catalogue of GBFS feeds we know how to poll.
--
-- GBFS is a standard rather than one city's API, which is the whole reason
-- this source was chosen: a destination maps to a slug exactly the way it
-- already maps to a climate slug. Adding a city is one insert, not a redeploy,
-- which is why this is a table and not a constant in src/lib.
-- ---------------------------------------------------------------------------

create table public.bike_systems (
  slug            text primary key,
  name            text not null,
  city            text not null,

  status_url      text not null,
  information_url text not null,

  -- What the feed itself advertises. Divvy says 60, so polling faster than
  -- that re-reads bytes we already have. The cron interval is derived from
  -- this rather than guessed -- see AGENTS.md on cadence.
  ttl_seconds     integer not null default 60,

  created_at      timestamptz not null default now(),

  constraint bike_systems_ttl_sane check (ttl_seconds between 10 and 3600)
);

alter table public.bike_systems enable row level security;

create policy "Signed-in users may read the system catalogue"
  on public.bike_systems for select
  to authenticated
  using (true);

-- Refused explicitly rather than by omission, so a reviewer reading
-- pg_policies sees a decision instead of a gap. The service role bypasses RLS,
-- so none of this blocks the worker.
create policy "Nobody may add a system"
  on public.bike_systems for insert to authenticated with check (false);
create policy "Nobody may change a system"
  on public.bike_systems for update to authenticated using (false);
create policy "Nobody may remove a system"
  on public.bike_systems for delete to authenticated using (false);

-- Every one of these ten URLs was fetched and checked for a 200 before being
-- written here, with the station count noted. Two surprises worth recording:
-- the lyft.com path pattern that serves Chicago 403s for New York and returns
-- an empty station list for Washington, so those two use their branded
-- domains; and Bay Wheels 301s on its branded domain, so it uses the lyft
-- path. Don't "tidy" these into one pattern -- there isn't one.
insert into public.bike_systems (slug, name, city, status_url, information_url) values
  ('chi', 'Divvy',             'Chicago',
   'https://gbfs.divvybikes.com/gbfs/en/station_status.json',
   'https://gbfs.divvybikes.com/gbfs/en/station_information.json'),      -- 2078 stations
  ('nyc', 'Citi Bike',         'New York',
   'https://gbfs.citibikenyc.com/gbfs/en/station_status.json',
   'https://gbfs.citibikenyc.com/gbfs/en/station_information.json'),     -- 2518 stations
  ('bos', 'Bluebikes',         'Boston',
   'https://gbfs.bluebikes.com/gbfs/en/station_status.json',
   'https://gbfs.bluebikes.com/gbfs/en/station_information.json'),       --  628 stations
  ('dc',  'Capital Bikeshare', 'Washington',
   'https://gbfs.capitalbikeshare.com/gbfs/en/station_status.json',
   'https://gbfs.capitalbikeshare.com/gbfs/en/station_information.json'),--  873 stations
  ('sf',  'Bay Wheels',        'San Francisco',
   'https://gbfs.lyft.com/gbfs/1.1/bay/en/station_status.json',
   'https://gbfs.lyft.com/gbfs/1.1/bay/en/station_information.json');    --  654 stations

-- ---------------------------------------------------------------------------
-- stations: one row per station, carrying the static description and the live
-- counts together so the page can render a name without a join.
--
-- The two halves arrive on different clocks. station_information.json is 1.1MB
-- and almost never changes, so it is fetched when a system gains its first
-- follower and rarely after. station_status.json is small and is fetched every
-- run. Don't collapse them into one fetch.
-- ---------------------------------------------------------------------------

create table public.stations (
  system_slug      text not null references public.bike_systems(slug) on delete cascade,
  station_id       text not null,

  -- Nullable on purpose, and this is load-bearing rather than lazy. A station
  -- can appear in station_status before the next station_information fetch
  -- has given it a name. With `not null` that upsert would fail and take the
  -- whole run down with it; nullable means the row lands with live counts and
  -- gains its name on the next information fetch.
  name             text,
  lat              double precision,
  lon              double precision,
  capacity         integer,

  bikes_available  integer,
  ebikes_available integer,
  docks_available  integer,

  -- The feed's own timestamp for this station, not ours. Kept separate from
  -- updated_at because "the data is old" and "we haven't written lately" are
  -- different failures and the page distinguishes them.
  last_reported    timestamptz,
  updated_at       timestamptz not null default now(),

  primary key (system_slug, station_id)
);

alter table public.stations enable row level security;

create policy "Signed-in users may read stations"
  on public.stations for select
  to authenticated
  using (true);

create policy "Clients may not write stations"
  on public.stations for insert to authenticated with check (false);
create policy "Clients may not change stations"
  on public.stations for update to authenticated using (false);
create policy "Clients may not remove stations"
  on public.stations for delete to authenticated using (false);
