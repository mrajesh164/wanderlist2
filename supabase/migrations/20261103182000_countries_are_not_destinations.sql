-- A country is not a destination.
--
-- Eight rows in the generated catalogue name one, because the system is
-- nationwide: Czechia, Germany, Poland, Slovenia, Luxembourg, Cyprus,
-- Bosnia and Herzegovina, and Switzerland with 12,563 stations. They cleared the geocode gate honestly -- a compact
-- country's centroid really is within 100 km of its stations -- but "the
-- weather in Germany" is the weather at a point in Hesse, and the nearest dock
-- to "Germany" means nothing to anyone packing a bag.
--
-- scripts/verify-systems.mjs now rejects them at source: Open-Meteo's
-- `feature_code` is PCLI for a country and PPL* for a populated place, so
-- city-states still pass (Monaco and Singapore both come back PPLC). This
-- migration applies the same decision to the catalogue already generated,
-- rather than hand-editing a file whose header says not to. The eight were
-- found by running that same feature_code check over all 244 verified rows,
-- not by reading the list and recognising names -- which is how the first
-- pass missed Cyprus and Bosnia and Herzegovina.
--
-- Luxembourg is the interesting one and it is correctly out: the name geocodes
-- to the country, not the city, so /api/climate would have answered with the
-- country's centroid either way.

update public.bike_systems
   set verified_at = null
 where lower(city) in
   ('bosnia and herzegovina', 'cyprus', 'czechia', 'germany', 'luxembourg',
    'poland', 'slovenia', 'switzerland');
