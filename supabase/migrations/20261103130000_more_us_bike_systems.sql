-- Seven more US cities.
--
-- Five was never a principled number, it was the cities I happened to check on
-- the first pass — all of them Lyft-operated, because Divvy was the first one I
-- looked at and I generalised from its URL shape. A trip to Los Angeles got
-- "no bikeshare system here yet", which is not true: LA has 224 docked stations.
--
-- Most of the rest run on BCycle rather than Lyft, which is why the pattern
-- search missed them. Every one of the fourteen URLs below was fetched and
-- checked for 200 before being written here:
--
--   Los Angeles   224    Philadelphia  322    Portland  308
--   Denver        119    Milwaukee     172    Madison   111
--   El Paso        20
--
-- Nothing has to be seeded by hand: a city with a system but no stations loads
-- itself the first time a trip goes there, through /api/seed-city.
insert into public.bike_systems (slug, name, city, status_url, information_url, lat, lon) values
  ('la',  'Metro Bike Share', 'Los Angeles',
   'https://gbfs.bcycle.com/bcycle_lametro/station_status.json',
   'https://gbfs.bcycle.com/bcycle_lametro/station_information.json', 34.0522, -118.2437),
  ('phl', 'Indego', 'Philadelphia',
   'https://gbfs.bcycle.com/bcycle_indego/station_status.json',
   'https://gbfs.bcycle.com/bcycle_indego/station_information.json', 39.9526,  -75.1652),
  ('pdx', 'Biketown', 'Portland',
   'https://gbfs.biketownpdx.com/gbfs/en/station_status.json',
   'https://gbfs.biketownpdx.com/gbfs/en/station_information.json', 45.5152, -122.6784),
  ('den', 'Lyft Bikes', 'Denver',
   'https://gbfs.lyft.com/gbfs/1.1/den/en/station_status.json',
   'https://gbfs.lyft.com/gbfs/1.1/den/en/station_information.json', 39.7392, -104.9903),
  ('mke', 'Bublr Bikes', 'Milwaukee',
   'https://gbfs.bcycle.com/bcycle_bublr/station_status.json',
   'https://gbfs.bcycle.com/bcycle_bublr/station_information.json', 43.0389,  -87.9065),
  ('msn', 'BCycle', 'Madison',
   'https://gbfs.bcycle.com/bcycle_madison/station_status.json',
   'https://gbfs.bcycle.com/bcycle_madison/station_information.json', 43.0731,  -89.4012),
  ('elp', 'Sun Cycle', 'El Paso',
   'https://gbfs.bcycle.com/bcycle_elpaso/station_status.json',
   'https://gbfs.bcycle.com/bcycle_elpaso/station_information.json', 31.7619, -106.4850);
