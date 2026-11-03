/**
 * Live bikeshare rows, and how fresh they are.
 *
 * Pure, no React — the hook that fetches lives with its component, because
 * `use-climate.ts` is the one hook allowed in this folder and the rule says a
 * second one moves to `src/components/` rather than widening the exception.
 */

export type Station = {
  system_slug: string;
  station_id: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
  capacity: number | null;
  bikes_available: number | null;
  ebikes_available: number | null;
  docks_available: number | null;
  last_reported: string | null;
  updated_at: string;
};

export type BikeSystem = {
  slug: string;
  name: string;
  city: string;
  /** Centre of the system, used to disambiguate a place name. */
  lat: number | null;
  lon: number | null;
};

/**
 * Metres between two points, good enough for "which station is closest".
 *
 * Equirectangular rather than haversine on purpose: over the couple of
 * kilometres a person would walk, the two agree to within a metre or so, and
 * this is comparing candidates rather than navigating.
 */
export function metresBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const x = (b.lon - a.lon) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.round(Math.sqrt(x * x + y * y) * R);
}

/**
 * Rounded, because a walking distance quoted to the metre is false precision —
 * but not so rounded that two different stations read the same.
 *
 * The first version bucketed to 50m above 100m, which turned a genuine 144m
 * and 171m into "150 m" and "150 m". Two rows claiming the same distance in a
 * list *sorted by distance* reads as a bug, and it loses the one thing the
 * number is for: choosing between them. Ten-metre buckets are still coarser
 * than the station coordinates are accurate, and they keep neighbours apart.
 */
export function distanceLabel(metres: number): string {
  if (metres < 500) return `${Math.round(metres / 10) * 10} m`;
  if (metres < 1000) return `${Math.round(metres / 50) * 50} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export type WorkerRun = {
  started_at: string;
  ok: boolean;
  rows_changed: number;
  error: string | null;
};

/** The cron interval, in seconds. Thresholds below are multiples of it. */
const POLL_SECONDS = 30;

export type Freshness = "loading" | "fresh" | "stale" | "down";

/**
 * Thresholds are expressed in cron intervals, not in literal seconds, so
 * changing the schedule doesn't silently leave the page lying about how
 * current it is.
 */
const FRESH_INTERVALS = 2; // 60s
const STALE_INTERVALS = 10; // 5 minutes

/**
 * `stale` and `down` are genuinely different and the page must not conflate
 * them: stale means the pipe is slow, down means it is broken. Telling them
 * apart is the entire reason `worker_runs` exists — `stations.updated_at`
 * alone can only say the numbers are old, never why.
 */
export function freshnessOf(
  latest: WorkerRun | null,
  lastOk: WorkerRun | null,
  now = Date.now(),
): Freshness {
  if (!latest) return "loading";
  if (!latest.ok) return "down";
  if (!lastOk) return "down";

  const age = (now - Date.parse(lastOk.started_at)) / 1000;
  if (age <= FRESH_INTERVALS * POLL_SECONDS) return "fresh";
  if (age <= STALE_INTERVALS * POLL_SECONDS) return "stale";

  /* A worker that hasn't succeeded in ten intervals isn't slow, it's stopped —
     even if nothing has reported an error. Silence is its own failure. */
  return "down";
}

function agoLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"} ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

/**
 * One line, above the board, never a badge per row. Says what is true and —
 * when something is wrong — what is wrong, rather than showing ageing numbers
 * as though they were live.
 */
export function freshnessLine(
  state: Freshness,
  lastOk: WorkerRun | null,
  now = Date.now(),
): string {
  switch (state) {
    case "loading":
      return "Checking for bikes…";
    case "fresh":
      return `Updated ${agoLabel(lastOk?.started_at ?? null, now)}`;
    case "stale":
      return `Last updated ${agoLabel(lastOk?.started_at ?? null, now)}`;
    case "down":
      return "Not updating. The last check failed.";
  }
}

/**
 * Ebikes are a subset of bikes, never a separate pool — don't add them.
 *
 * Both numbers are shown because a stand can fail you in either direction:
 * no bikes and you cannot start there, no empty docks and you cannot finish
 * there. "Docks" alone doesn't say which it means, so the label spells it out
 * and the section header explains it once.
 */
export function countsLabel(s: Station): string {
  if (s.bikes_available === null) return "—";
  const bikes = `${s.bikes_available} bike${s.bikes_available === 1 ? "" : "s"}`;
  if (s.docks_available === null) return bikes;
  return `${bikes} · ${s.docks_available} space${s.docks_available === 1 ? "" : "s"}`;
}

/** Said once per section, because neither number is guessable. */
export const COUNTS_EXPLAINER =
  "Bikes you could take now, and empty spaces to return one to.";
