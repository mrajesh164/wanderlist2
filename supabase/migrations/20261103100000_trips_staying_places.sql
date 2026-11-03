-- Several places per trip, not one.
--
-- A single "where you're staying" answers "can I get a bike outside the hotel".
-- It does not help someone deciding between neighbourhoods, which is the other
-- half of what live counts are good for. So it becomes a list.
--
-- jsonb rather than a fourth table, for the same reasons `items` is jsonb: the
-- list is always read and written whole, nothing filters or joins on a single
-- place, and one row per trip means one RLS check instead of one per place.
alter table public.trips
  add column staying_places jsonb not null default '[]';

-- Carry across anything saved under the single-place columns.
update public.trips
   set staying_places = jsonb_build_array(
         jsonb_build_object('label', staying, 'lat', staying_lat, 'lon', staying_lon))
 where staying is not null
   and staying_lat is not null
   and staying_lon is not null;

-- `staying`, `staying_lat` and `staying_lon` are left in place and are now
-- vestigial, the same way `is_example` is. They lasted about an hour before the
-- single-place idea turned out to be too small, and dropping a column is a
-- destructive migration with no benefit beyond tidiness — the Supabase MCP
-- declines it, which is the right default. Nothing reads or writes them.
