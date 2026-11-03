/**
 * Work out which cities this app can actually serve, and emit them as SQL.
 *
 *   node scripts/verify-systems.mjs > supabase/migrations/<stamp>_verified_systems.sql
 *
 * The destination field only offers cities where **both** halves of the app
 * work — a live bikeshare feed with bikes in it, and weather for the right
 * place. This script is how that list is derived, so the catalogue in
 * `bike_systems` is generated from MobilityData's registry rather than typed
 * by hand. Re-run it when coverage looks stale; it takes about three minutes.
 *
 * A city has to clear five gates. Every one of them was added because a real
 * system failed it in a way that reached the screen:
 *
 *  1. The discovery document lists `station_information` and `station_status`.
 *     Free-floating fleets (Dott, most scooter operators) publish neither.
 *  2. At least MIN_STATIONS stations. Three virtual parking squares is not a
 *     system anyone can plan around.
 *  3. Some station reports `num_docks_available > 0` — it is dock-based.
 *  4. Some station has a bike in it right now. Denver's docked system shut
 *     down in 2020 and its 119 stations still report 16 empty spaces and zero
 *     bikes, forever; Pittsburgh's Pogoh reads the same way out of season.
 *     Capacity cannot catch this and neither can the registry.
 *  5. The city NAME geocodes to within MAX_GEO_KM of where its stations
 *     actually are. This is the weather half: `/api/climate` geocodes the
 *     destination string, and the registry's "Location" column is not always
 *     a city — it holds "Austria", "Mecklenburg-Vorpommern" and bare "DE",
 *     which geocode to nothing or to the wrong continent. It also catches the
 *     subtler case, where a real city name resolves somewhere else entirely:
 *     Cornwall GB → Cornwall, Pennsylvania; Brest FR → Brest, Belarus.
 *
 * What is deliberately NOT a gate: whether the operator calls them bikes or
 * scooters. That was tried and it cannot be done honestly — `form_factor` in
 * `vehicle_types.json` lists both for Divvy, Pogoh, Bird and Spin alike, and
 * dock counts look identical across them. The gates above are about whether
 * the data is useful, which is the thing that actually matters on the page.
 */

const REGISTRY =
  "https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv";
const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";

const CONCURRENCY = 24;
const TIMEOUT_MS = 12_000;
const MIN_STATIONS = 20;
const MAX_GEO_KM = 100;

/* ------------------------------------------------------------------ CSV */

function splitRow(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/* ----------------------------------------------------------------- GBFS */

/** 1.x nests feeds under a language key; 3.0 puts them on `data.feeds`. */
function feedsFrom(doc) {
  const data = doc?.data;
  if (!data || typeof data !== "object") return {};
  const list = data.feeds ?? (data.en ?? Object.values(data)[0])?.feeds;
  return Object.fromEntries((list ?? []).map((f) => [f.name, f.url]));
}

/** 3.0 renamed `num_bikes_available` to `num_vehicles_available`. */
const bikesIn = (s) =>
  typeof s.num_bikes_available === "number"
    ? s.num_bikes_available
    : typeof s.num_vehicles_available === "number"
      ? s.num_vehicles_available
      : 0;

/** 3.0 made `name` a localised array of `{ text, language }`. */
function localised(v) {
  if (typeof v === "string" && v) return v;
  if (!Array.isArray(v)) return null;
  const en = v.find((e) => e?.language === "en");
  return en?.text ?? v[0]?.text ?? null;
}

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

async function probe(row) {
  const discovery = row["Auto-Discovery URL"];
  if (!discovery) return { ok: false, why: "no-url" };
  try {
    const feeds = feedsFrom(await json(discovery));
    const si = feeds["station_information"];
    const ss = feeds["station_status"];
    if (!si || !ss) return { ok: false, why: "no-station-feeds" };

    const stations = (await json(si)).data?.stations ?? [];
    const located = stations.filter(
      (s) => typeof s.lat === "number" && typeof s.lon === "number",
    );
    if (located.length < MIN_STATIONS) return { ok: false, why: "too-few" };

    const live = (await json(ss)).data?.stations ?? [];
    if (!live.some((s) => (s.num_docks_available ?? 0) > 0)) {
      return { ok: false, why: "no-docks" };
    }
    if (!live.some((s) => bikesIn(s) > 0)) return { ok: false, why: "no-bikes" };

    return {
      ok: true,
      status_url: ss,
      information_url: si,
      stations: located.length,
      named: located.filter((s) => localised(s.name)).length,
      lat: +(located.reduce((a, s) => a + s.lat, 0) / located.length).toFixed(5),
      lon: +(located.reduce((a, s) => a + s.lon, 0) / located.length).toFixed(5),
    };
  } catch (cause) {
    return { ok: false, why: String(cause.message).slice(0, 40) };
  }
}

/* ------------------------------------------------------------- geocoding */

const km = (a, b) => {
  const R = 6371;
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.round(Math.sqrt(x * x + y * y) * R);
};

/**
 * The same call `/api/climate` makes: count=1, language=en.
 *
 * Returns the distance in km from where the stations actually are, or null if
 * the name cannot be used as a destination at all.
 *
 * **A country is not a destination.** Several registry rows name one, because
 * the system is nationwide: "Czechia", "Germany", "Switzerland" (12,563
 * stations). Those geocode fine, and for a compact country the centroid even
 * lands within the distance gate — but "the weather in Germany" is the weather
 * at a point in Hesse, and the nearest dock to "Germany" means nothing.
 * `feature_code` says it outright: PCLI is a country, PPL* is a populated
 * place, and city-states keep working because Monaco and Singapore come back
 * PPLC.
 */
async function geocodeDistance(city, centre) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `${GEOCODE}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (!res.ok) return null;
      const hit = (await res.json()).results?.[0];
      if (!hit) return null;
      if (String(hit.feature_code ?? "").startsWith("PCL")) return null;
      return km({ lat: hit.latitude, lon: hit.longitude }, centre);
    } catch {
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ main */

const slugFor = (city, systemId) =>
  ((systemId || city).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sys")
    .slice(0, 32);

const sql = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

const text = await (await fetch(REGISTRY)).text();
const lines = text.split(/\r?\n/).filter(Boolean);
const head = splitRow(lines[0]);
const rows = lines
  .slice(1)
  .map((l) => Object.fromEntries(splitRow(l).map((c, i) => [head[i], c])));
console.error(`registry: ${rows.length} systems`);

const passed = [];
const why = {};
let next = 0;
let done = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < rows.length) {
      const row = rows[next++];
      const result = await probe(row);
      if (++done % 200 === 0) console.error(`  probed ${done}/${rows.length}`);
      if (result.ok) passed.push({ row, result });
      else why[result.why] = (why[result.why] ?? 0) + 1;
    }
  }),
);
console.error(`feeds usable: ${passed.length}`);
console.error(`  rejected: ${JSON.stringify(why)}`);

/* One system per city — the one with the most stations, since several
   operators serve one city and the person picking a destination does not
   care which. */
const byCity = new Map();
for (const p of passed) {
  const [city, ...rest] = (p.row["Location"] ?? "").split(",").map((s) => s.trim());
  if (!city) continue;
  const key = city.toLowerCase();
  const prev = byCity.get(key);
  if (prev && prev.result.stations >= p.result.stations) continue;
  byCity.set(key, { ...p, city, region: rest.join(", "), country: p.row["Country Code"] ?? "" });
}
console.error(`cities with a usable feed: ${byCity.size}`);

const verified = [];
let dropped = 0;
for (const entry of byCity.values()) {
  const d = await geocodeDistance(entry.city, entry.result);
  if (d === null || d > MAX_GEO_KM) {
    dropped++;
    console.error(`  no weather: ${entry.city} (${entry.country}) — ${d === null ? "does not geocode" : d + " km away"}`);
  } else {
    verified.push({ ...entry, geoKm: d });
  }
  await new Promise((r) => setTimeout(r, 250));
}
verified.sort((a, b) => a.city.localeCompare(b.city));
console.error(`verified: ${verified.length} cities (${dropped} dropped for weather)`);

const stamp = new Date().toISOString().slice(0, 10);
process.stdout.write(`-- Generated by scripts/verify-systems.mjs on ${stamp}. Do not hand-edit.
--
-- ${verified.length} cities, ${new Set(verified.map((v) => v.country)).size} countries: every one probed
-- end to end on the day of this run -- station feeds read, a bike seen in a
-- dock, and the city name geocoded to within ${MAX_GEO_KM} km of its own
-- stations. The script's header explains each gate and why it is there.
--
-- Nothing is deleted. A system that stops passing has verified_at cleared,
-- which takes it out of the destination picker while leaving its row -- and
-- the stations that reference it -- alone. Denver is the standing example:
-- its feed still answers, its bikes are gone, and its 119 stations are
-- somebody's history.

update public.bike_systems set verified_at = null;

insert into public.bike_systems
  (slug, name, city, region, country, status_url, information_url, lat, lon,
   station_count, verified_at)
values
${verified
  .map(
    (v) =>
      `  (${sql(slugFor(v.city, v.row["System ID"]))}, ${sql(v.row["Name"] || "Bikeshare")}, ${sql(v.city)}, ${sql(v.region || null)}, ${sql(v.country || null)}, ${sql(v.result.status_url)}, ${sql(v.result.information_url)}, ${v.result.lat}, ${v.result.lon}, ${v.result.stations}, now())`,
  )
  .join(",\n")}
-- Keyed on the city, not the slug: see the bike_systems_one_per_city index.
-- A regenerated catalogue has to update the row a trip already points at,
-- and registry System IDs are not stable enough to key on.
on conflict (lower(city)) do update set
  name            = excluded.name,
  region          = excluded.region,
  country         = excluded.country,
  status_url      = excluded.status_url,
  information_url = excluded.information_url,
  lat             = excluded.lat,
  lon             = excluded.lon,
  station_count   = excluded.station_count,
  verified_at     = excluded.verified_at;
`);
