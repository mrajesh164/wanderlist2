-- Give each system a centre point, so an ambiguous place name can be resolved
-- without asking the person which one they meant.
--
-- The geocoder returns candidates across the whole world: "Wicker Park" comes
-- back as both Illinois and Indiana, and "Logan Square" as both Illinois and
-- Pennsylvania. Measured, not assumed -- those are real responses. With a
-- centre for the system the trip is in, the nearest candidate is the right one
-- every time, and nobody has to disambiguate anything.
--
-- Hardcoded rather than averaged from the stations, deliberately: a system has
-- no stations until it is seeded, so an average would be null exactly when the
-- first person needed it. City centres do not move.

alter table public.bike_systems
  add column lat double precision,
  add column lon double precision;

update public.bike_systems set lat = 41.8781, lon =  -87.6298 where slug = 'chi';
update public.bike_systems set lat = 40.7128, lon =  -74.0060 where slug = 'nyc';
update public.bike_systems set lat = 42.3601, lon =  -71.0589 where slug = 'bos';
update public.bike_systems set lat = 38.9072, lon =  -77.0369 where slug = 'dc';
update public.bike_systems set lat = 37.7749, lon = -122.4194 where slug = 'sf';
