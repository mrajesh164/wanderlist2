-- The live layer, part two: what each person chose to watch.
--
-- This is the only table in the live layer that holds anybody's data, so it is
-- the only one fenced per user. It is also the table the assignment means by
-- "each person chooses what they follow, with row-level security on their
-- choices".
--
-- Clerk user ids are strings, not UUIDs (user_2abc...), so user_id is text and
-- every policy compares against the JWT's subject claim. auth.uid() expects a
-- Supabase UUID and will NOT work here -- the same note as trips and
-- kit_items, repeated because it is the single most likely thing to get wrong.

create table public.station_follows (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,

  system_slug text not null references public.bike_systems(slug) on delete cascade,
  station_id  text not null,

  -- Optional, so a follow can hang off the trip that motivated it ("the
  -- stations by the hotel in Lisbon") or stand on its own. set null rather
  -- than cascade: deleting a trip shouldn't silently stop watching a station
  -- you still care about.
  trip_id     uuid references public.trips(id) on delete set null,

  created_at  timestamptz not null default now(),

  -- Following something twice is a no-op, not an error. Same lesson as
  -- "already in your inventory" and "already on this list": a repeat is a
  -- reasonable request and the app should absorb it.
  unique (user_id, system_slug, station_id)
);

-- Deliberately NOT a foreign key to stations(system_slug, station_id).
--
-- The worker is what fills stations, so requiring the row to exist first
-- creates a bootstrap deadlock: the first person to follow a station in a city
-- nobody follows yet could never do it. The worker treats follows as the
-- source of truth for what to poll and will create the station row on its next
-- run, at most one cron interval later.
--
-- The worker reads this by system, then by station, and never by user -- the
-- unique index above leads with user_id so it cannot serve that query.
create index station_follows_by_station
  on public.station_follows (system_slug, station_id);

alter table public.station_follows enable row level security;

-- All four policies, and insert and update carry `with check` as well as
-- `using`. Without `with check`, `using` alone lets someone write a row
-- stamped with another person's user_id -- which is exactly the omission
-- /security-review caught in Assignment 4. Don't make it again here.

create policy "People may read their own follows"
  on public.station_follows for select
  to authenticated
  using ((auth.jwt() ->> 'sub') = user_id);

create policy "People may add their own follows"
  on public.station_follows for insert
  to authenticated
  with check ((auth.jwt() ->> 'sub') = user_id);

create policy "People may change their own follows"
  on public.station_follows for update
  to authenticated
  using ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);

create policy "People may remove their own follows"
  on public.station_follows for delete
  to authenticated
  using ((auth.jwt() ->> 'sub') = user_id);
