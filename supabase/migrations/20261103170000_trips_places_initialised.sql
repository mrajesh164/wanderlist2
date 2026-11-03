-- Has this trip been given its default place yet?
--
-- A new trip opens on an empty bikes panel and a question, which wastes the
-- one part of the app that is already live: the city itself is a perfectly
-- good first anchor, and bike_systems already knows its centre.
--
-- The flag exists so the default can be *removed*. Without it the rule would
-- be "add the city whenever the list is empty", and deleting it would simply
-- bring it back on the next load — which reads as the app arguing with you.
-- One write, once per trip, and after that the list is entirely the person's.
alter table public.trips
  add column places_initialised boolean not null default false;

-- Trips that already have places have clearly been past this point.
update public.trips
   set places_initialised = true
 where jsonb_array_length(staying_places) > 0;
