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
  /** GBFS 3.0's name for the same number. */
  num_vehicles_available?: unknown;
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

/**
 * A station name, from either GBFS generation.
 *
 * Up to 2.x `name` is a plain string. **GBFS 3.0 made it a localised array** —
 * `[{ text, language }, …]` — and a plain-string check returns null for it, so
 * every station in a 3.0 feed came out nameless and the UI fell back to
 * showing numeric ids. Toronto did exactly that: 1,075 stations, every one
 * displayed as "7713".
 *
 * Prefers English, falls back to the first entry, because a name in the wrong
 * language still beats an id.
 */
function localised(v: unknown): string | null {
  const plain = str(v);
  if (plain) return plain;
  if (!Array.isArray(v)) return null;
  const entries = v as { text?: unknown; language?: unknown }[];
  const en = entries.find((e) => e?.language === "en");
  return str(en?.text) ?? str(entries[0]?.text);
}

/**
 * When a station last spoke, in either GBFS generation.
 *
 * Up to 2.x this is unix seconds. **GBFS 3.0 made it an RFC3339 string**, so a
 * seconds-only reader stores null for every station in a 3.0 feed — which is
 * how Toronto ended up with 1,075 rows and not one `last_reported` between
 * them. Same shape of bug as `localised()` below; 3.0 renamed more than names.
 */
export function unixToISO(v: unknown): string | null {
  const n = num(v);
  if (n !== null) return n > 0 ? new Date(n * 1000).toISOString() : null;

  const s = str(v);
  if (!s) return null;
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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
      /* 2.x calls this `num_bikes_available`; **3.0 renamed it
         `num_vehicles_available`**. Reading only the old name is why every
         3.0 system — Toronto, Pittsburgh, bicimad — stored a null bike count
         and the trip page concluded there was no bikeshare there at all. */
      bikes_available:
        num(s?.num_bikes_available) ?? num(s?.num_vehicles_available),
      /* Deliberately 2.x-only. 3.0 moved the breakdown into
         `vehicle_types_available`, keyed by ids whose meaning lives in a
         third feed (`vehicle_types.json`) — so working out which are electric
         means another fetch per system. Null is honest; guessing from id
         names like "EFIT" would not be, and the UI already treats a missing
         ebike count as "not published" rather than as zero. */
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
      name: localised(s?.name),
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

/**
 * Is this a URL the worker should be willing to fetch?
 *
 * The feed URLs are not ours. They come from a GBFS operator's own discovery
 * document, reached from MobilityData's registry, and the worker fetches them
 * with the service role from inside Supabase's network. Nobody using this app
 * picks them — the most a person can do is choose which registry city to look
 * up — so this is a supply-chain guard rather than a user-input one: it is
 * what stops a compromised operator (or a merged-but-hostile registry entry)
 * from pointing us at `http://169.254.169.254/` or `file:///`.
 *
 * **Not https-only, deliberately.** Five systems the app offers still serve
 * plain http — Buffalo, Eugene, Hamilton, Long Beach, Rosario — and dropping
 * five working cities to close a hole that scheme-checking doesn't close
 * anyway would be the wrong trade. What is actually refused is a scheme that
 * isn't http(s), and a host that names the machine we are running on or a
 * private network.
 *
 * Literal matching only. Resolving a hostname to check its address would be
 * sound and is a different piece of work — it needs DNS in both runtimes and
 * it still races rebinding. This stops the cheap version.
 */
export function fetchableFeedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return false;
  }

  /* Loopback, link-local (169.254.169.254 is the cloud metadata address), and
     the three private IPv4 ranges. Plus IPv6 loopback and unique-local. */
  if (
    /^127\./.test(host) ||
    /^0\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    host === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(host)
  ) {
    return false;
  }

  return true;
}
