-- Where you're staying, saved on the trip.
--
-- The bikes panel used to anchor on the city centre and ask you to retype a
-- neighbourhood every visit. The city centre is nobody's hotel, and a search
-- box you fill in again on every device is not a saved preference.
--
-- Coordinates are cached alongside the text so the page doesn't re-geocode the
-- same string on every load. The text is what the person typed and is what gets
-- shown back to them; the pair is derived and may be null if the geocoder
-- couldn't place it, which is a state the UI has to handle rather than assume
-- away.
alter table public.trips
  add column staying     text,
  add column staying_lat double precision,
  add column staying_lon double precision;
