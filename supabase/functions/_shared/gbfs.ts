/**
 * Reading a GBFS feed, and working out what actually changed.
 *
 * Deliberately free of Deno globals, `npm:` specifiers and remote imports, so
 * it stays safe for the Next.js side to import. See AGENTS.md: tsconfig's
 * `exclude` only drops files from the initial glob, and anything src/ imports
 * gets pulled back into the program and type-checked anyway.
 *
 * Everything here is pure. The worker is the part that talks to the network and
 * the database; this is the part worth testing, and the test runs it against a
 * saved copy of a real response.
 */

/** One station's live counts, shaped like the `stations` table. */
export type StationCounts = {
  bikes_available: number | null;
  ebikes_available: number | null;
  docks_available: number | null;
  last_reported: string | null;
};

/** The static half, from station_information.json. */
export type StationFacts = {
  name: string | null;
  lat: number | null;
  lon: number | null;
  capacity: number | null;
};

export type StationRow = StationCounts & {
  system_slug: string;
  station_id: string;
};

export type StationFactRow = StationFacts & {
  system_slug: string;
  station_id: string;
};

type RawStatus = {
  station_id?: unknown;
  num_bikes_available?: unknown;
  num_ebikes_available?: unknown;
  num_docks_available?: unknown;
  last_reported?: unknown;
};

type RawInformation = {
  station_id?: unknown;
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  capacity?: unknown;
};

type Feed<T> = { data?: { stations?: T[] } };

/* The feed is someone else's JSON and the worker runs unattended, so a field
   that arrives as a string, a null or not at all must not throw — it becomes
   null and the row still lands. A run that dies on one malformed station would
   lose the other two thousand. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** GBFS reports times as unix seconds; the column is timestamptz. */
export function unixToISO(v: unknown): string | null {
  const n = num(v);
  if (n === null || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/**
 * station_status.json -> counts, keyed by station_id.
 *
 * Note what is NOT done here: `num_ebikes_available` is a *subset* of
 * `num_bikes_available`, not a separate pool. Measured rather than assumed —
 * a station went bikes 1->2 and ebikes 1->2 while docks fell by exactly one,
 * which only works if the arriving bike was counted once. Never add them.
 */
export function parseStatus(
  feed: Feed<RawStatus>,
  systemSlug: string,
): Map<string, StationRow> {
  const out = new Map<string, StationRow>();
  for (const s of feed?.data?.stations ?? []) {
    const id = str(s?.station_id);
    if (!id) continue;
    out.set(id, {
      system_slug: systemSlug,
      station_id: id,
      bikes_available: num(s?.num_bikes_available),
      ebikes_available: num(s?.num_ebikes_available),
      docks_available: num(s?.num_docks_available),
      last_reported: unixToISO(s?.last_reported),
    });
  }
  return out;
}

/** station_information.json -> the static half, keyed by station_id. */
export function parseInformation(
  feed: Feed<RawInformation>,
  systemSlug: string,
): StationFactRow[] {
  const out: StationFactRow[] = [];
  for (const s of feed?.data?.stations ?? []) {
    const id = str(s?.station_id);
    if (!id) continue;
    out.push({
      system_slug: systemSlug,
      station_id: id,
      name: str(s?.name),
      lat: num(s?.lat),
      lon: num(s?.lon),
      capacity: num(s?.capacity),
    });
  }
  return out;
}

const COUNT_FIELDS = [
  "bikes_available",
  "ebikes_available",
  "docks_available",
] as const;

/**
 * The heart of it: of the stations somebody follows, which ones actually moved?
 *
 * Two calls 120s apart found 72 of Chicago's 2078 stations had changed — 3.5%.
 * Returning only those is what keeps the write small, and Supabase Realtime
 * bills every change sent to every open page, so writing all of them would be
 * roughly a 29x multiplier on the message budget for no added correctness.
 *
 * `last_reported` alone is not a change. A station re-reporting the same counts
 * is not news to anybody looking at the page, and treating it as one would put
 * the write volume straight back where it started.
 */
export function changedRows(
  incoming: Map<string, StationRow>,
  stored: Map<string, StationCounts>,
  followed: Iterable<string>,
): StationRow[] {
  const out: StationRow[] = [];
  for (const id of followed) {
    const next = incoming.get(id);
    if (!next) continue;

    const prev = stored.get(id);
    if (!prev) {
      out.push(next);
      continue;
    }

    if (COUNT_FIELDS.some((f) => prev[f] !== next[f])) out.push(next);
  }
  return out;
}
