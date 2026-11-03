/**
 * What the worker saves, run against saved copies of the real feeds.
 *
 *   npm test
 *
 * The fixtures in `__fixtures__/` are verbatim slices of two live responses —
 * six stations each from Divvy (GBFS 2.3) and Bike Share Toronto (GBFS 3.0),
 * captured on 3 November 2026. Two generations rather than one on purpose:
 * **every bug this file has caught in production was a 3.0 rename that a
 * 2.x-shaped reader silently turned into null**, and a fixture from only one
 * generation could not have caught any of them.
 *
 * No test framework and no new dependency: `node:test` and `node:assert` ship
 * with Node, and Node strips the types. The worker itself is not run here —
 * it talks to the network and to Postgres. What is run is the part that
 * decides *what gets written*, which is the part worth pinning down.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  changedRows,
  fetchableFeedUrl,
  parseInformation,
  parseStatus,
  unixToISO,
  type StationCounts,
} from "./gbfs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "__fixtures__", name), "utf8"));

const divvyStatus = fixture("divvy-2.3-station_status.json");
const divvyInfo = fixture("divvy-2.3-station_information.json");
const torontoStatus = fixture("toronto-3.0-station_status.json");
const torontoInfo = fixture("toronto-3.0-station_information.json");

/* ------------------------------------------------------------------ 2.x */

test("GBFS 2.x: counts and a unix timestamp", () => {
  const rows = parseStatus(divvyStatus, "chi");
  assert.equal(rows.size, 6, "one row per station in the feed");

  const raw = divvyStatus.data.stations[0];
  const row = rows.get(raw.station_id);
  assert.ok(row, "keyed by station_id");

  assert.equal(row.bikes_available, raw.num_bikes_available);
  assert.equal(row.docks_available, raw.num_docks_available);
  assert.equal(row.system_slug, "chi");

  /* 2.x reports seconds since the epoch; the column is timestamptz. */
  assert.equal(
    row.last_reported,
    new Date(raw.last_reported * 1000).toISOString(),
  );
});

test("GBFS 2.x: a plain-string name survives", () => {
  const facts = parseInformation(divvyInfo, "chi");
  assert.equal(facts.length, 6);
  for (const f of facts) {
    assert.equal(typeof f.name, "string");
    assert.ok(f.name.length > 0, `station ${f.station_id} has a name`);
    assert.equal(typeof f.lat, "number");
    assert.equal(typeof f.lon, "number");
  }
});

/* ------------------------------------------------------------------ 3.0 */

test("GBFS 3.0: bikes come from num_vehicles_available, not null", () => {
  /* The Pittsburgh bug. A reader that only knows `num_bikes_available`
     returns null here for every station, and the trip page concludes the
     city has no bikeshare at all. */
  const rows = parseStatus(torontoStatus, "bike-share-toronto");
  assert.equal(rows.size, 6);

  for (const raw of torontoStatus.data.stations) {
    assert.equal(
      raw.num_bikes_available,
      undefined,
      "the fixture really is 3.0-shaped, or this test proves nothing",
    );
    const row = rows.get(raw.station_id);
    assert.equal(row.bikes_available, raw.num_vehicles_available);
  }

  assert.ok(
    [...rows.values()].some((r) => r.bikes_available > 0),
    "at least one station has bikes, so a null would be visible",
  );
});

test("GBFS 3.0: an RFC3339 last_reported is parsed, not dropped", () => {
  const rows = parseStatus(torontoStatus, "bike-share-toronto");
  for (const raw of torontoStatus.data.stations) {
    assert.equal(typeof raw.last_reported, "string", "3.0 reports a string");
    const row = rows.get(raw.station_id);
    assert.equal(row.last_reported, new Date(raw.last_reported).toISOString());
  }
});

test("GBFS 3.0: the English text is pulled out of a localised name", () => {
  /* Toronto's first load showed 1,075 stations called "7713" because a
     plain-string check returns null for `[{ text, language }, …]`. */
  const facts = parseInformation(torontoInfo, "bike-share-toronto");
  const raw = torontoInfo.data.stations[0];
  assert.ok(Array.isArray(raw.name), "the fixture really is 3.0-shaped");

  const english = raw.name.find((n: { language: string }) => n.language === "en");
  assert.equal(facts[0].name, english.text);

  for (const f of facts) {
    assert.equal(typeof f.name, "string");
    assert.notEqual(f.name, f.station_id, "a name, not an id");
  }
});

test("ebikes stay null on 3.0 rather than being guessed", () => {
  /* 3.0 moved the breakdown into `vehicle_types_available`, keyed by ids
     whose meaning lives in a third feed. Null means "not published"; a zero
     would be a claim nobody made. */
  const rows = parseStatus(torontoStatus, "bike-share-toronto");
  for (const row of rows.values()) assert.equal(row.ebikes_available, null);
});

/* --------------------------------------------------- timestamps directly */

test("unixToISO takes both generations and refuses nonsense", () => {
  assert.equal(unixToISO(1793731639), "2026-11-03T18:47:19.000Z");
  assert.equal(unixToISO("2026-11-03T18:53:09.67Z"), "2026-11-03T18:53:09.670Z");
  assert.equal(unixToISO(0), null);
  assert.equal(unixToISO(null), null);
  assert.equal(unixToISO(undefined), null);
  assert.equal(unixToISO("not a date"), null);
});

/* ---------------------------------------------- what actually gets written */

test("only followed stations that moved are written", () => {
  const incoming = parseStatus(divvyStatus, "chi");
  const ids = [...incoming.keys()];

  /* Everything stored exactly as it arrived: nothing has moved. */
  const unchanged = new Map<string, StationCounts>(
    [...incoming].map(([id, r]) => [id, { ...r }]),
  );
  assert.deepEqual(
    changedRows(incoming, unchanged, ids),
    [],
    "a feed that repeats itself writes nothing — this is the 3.5% rule",
  );

  /* One bike taken from the first station. */
  const moved = new Map(unchanged);
  const first = ids[0];
  moved.set(first, {
    ...unchanged.get(first),
    bikes_available: unchanged.get(first).bikes_available + 1,
  });
  const out = changedRows(incoming, moved, ids);
  assert.equal(out.length, 1);
  assert.equal(out[0].station_id, first);
});

test("a station re-reporting the same counts is not a change", () => {
  /* `last_reported` moving on its own is not news to anybody looking at the
     page, and treating it as one would put the write volume straight back
     where it started. */
  const incoming = parseStatus(divvyStatus, "chi");
  const id = [...incoming.keys()][0];
  const stored = new Map<string, StationCounts>([
    [id, { ...incoming.get(id), last_reported: "2020-01-01T00:00:00.000Z" }],
  ]);
  assert.deepEqual(changedRows(incoming, stored, [id]), []);
});

test("nobody's follows means nobody's writes", () => {
  const incoming = parseStatus(divvyStatus, "chi");
  assert.deepEqual(
    changedRows(incoming, new Map(), []),
    [],
    "a station can move all it likes; if no one follows it, it is not written",
  );
});

test("a station followed but never stored is written once", () => {
  const incoming = parseStatus(divvyStatus, "chi");
  const id = [...incoming.keys()][0];
  const out = changedRows(incoming, new Map(), [id]);
  assert.equal(out.length, 1, "no stored row means everything is new");
});

test("a followed station the feed does not mention is skipped", () => {
  /* `station_follows` has deliberately no foreign key, so a follow can name a
     station the feed has never heard of. That must not invent a row. */
  const incoming = parseStatus(divvyStatus, "chi");
  assert.deepEqual(changedRows(incoming, new Map(), ["no-such-station"]), []);
});

/* ------------------------------------------------------- hostile input */

test("a malformed station loses its own fields, not the whole run", () => {
  /* The feed is someone else's JSON and the worker runs unattended. A run
     that threw on one bad station would lose the other two thousand. */
  const hostile = {
    data: {
      stations: [
        { station_id: "ok", num_bikes_available: 4, num_docks_available: 2 },
        { station_id: "bad", num_bikes_available: "lots", last_reported: {} },
        { num_bikes_available: 1 }, // no id at all
        { station_id: "also-ok", num_vehicles_available: 7 },
      ],
    },
  };
  const rows = parseStatus(hostile, "chi");

  assert.equal(rows.size, 3, "the station with no id is dropped, not thrown on");
  assert.equal(rows.get("ok").bikes_available, 4);
  assert.equal(rows.get("bad").bikes_available, null, "a string is not a count");
  assert.equal(rows.get("bad").last_reported, null);
  assert.equal(rows.get("also-ok").bikes_available, 7);
});

test("an empty or shapeless feed yields nothing", () => {
  assert.equal(parseStatus({}, "chi").size, 0);
  assert.equal(parseStatus({ data: {} }, "chi").size, 0);
  assert.deepEqual(parseInformation({}, "chi"), []);
});

/* ------------------------------------------------- what we agree to fetch */

test("feed URLs pointing at us or at a private network are refused", () => {
  /* The URLs come from a third party's discovery document and the worker
     fetches them with the service role from inside Supabase's network. */
  for (const ok of [
    "https://gbfs.lyft.com/gbfs/2.3/chi/en/station_status.json",
    "https://toronto.publicbikesystem.net/customer/gbfs/v3.0/station_status",
    "http://reddybikeshare.socialbicycles.com/opendata/station_status.json",
    "http://172.32.3.4/x", // outside the private range
  ]) {
    assert.equal(fetchableFeedUrl(ok), true, ok);
  }

  for (const no of [
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://localhost:54321/rest/v1/trips",
    "http://127.0.0.1/",
    "http://10.0.0.5/x",
    "http://172.16.3.4/x",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://db.internal/x",
    "file:///etc/passwd",
    "gopher://evil/",
    "not a url",
  ]) {
    assert.equal(fetchableFeedUrl(no), false, no);
  }
});
