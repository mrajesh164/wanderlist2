"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession, useUser } from "@clerk/nextjs";
import { Label, SectionRule } from "./Card";
import { Chip, QuietAction, SuggestionList } from "./Controls";
import { Field, TextInput } from "./Field";
import { useSupabase } from "@/lib/supabase";
import {
  countsLabel,
  distanceLabel,
  freshnessLine,
  freshnessOf,
  metresBetween,
  type BikeSystem,
  type Freshness,
  type Station,
  type WorkerRun,
} from "@/lib/stations";

/**
 * Bikes at the destination, live.
 *
 * Sits in the trip page's destination cluster — after the conditions strip and
 * *before* the packing list. The position is the point: this is a peer of
 * "what it's like there", not an appendix to "what to bring".
 *
 * The hook lives in this file rather than in `src/lib/`, because that folder
 * allows exactly one React file and the rule is that a second one comes here
 * instead of widening the exception.
 */

const SELECT =
  "system_slug, station_id, name, lat, lon, capacity, bikes_available, ebikes_available, docks_available, last_reported, updated_at";

export function StationBoard({ destination }: { destination: string }) {
  const supabase = useSupabase();
  /* The row has to carry the Clerk subject itself: the insert policy's
     `with check` compares it against the JWT, so a blank or borrowed id is
     refused rather than silently filed under somebody else. */
  const { user } = useUser();
  /* The raw Clerk session, needed to authenticate the Realtime socket. */
  const { session } = useSession();
  const userId = user?.id ?? null;

  const [system, setSystem] = useState<BikeSystem | null>(null);
  const [resolved, setResolved] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Station[]>([]);
  const [latestRun, setLatestRun] = useState<WorkerRun | null>(null);
  const [lastOkRun, setLastOkRun] = useState<WorkerRun | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Station[]>([]);
  const [near, setNear] = useState<{ label: string; lat: number; lon: number } | null>(null);

  /* Re-renders on a timer so "updated 14 seconds ago" keeps counting and a
     board nobody is touching still slides into `stale` on its own. Without
     this the page would claim the data was fresh indefinitely. */
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  /* Destination -> system. The same match the climate slug already does. */
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      /* Wrapped because an throw here used to leave `resolved` false forever,
         and the component rendered nothing at all — no panel, no loading line,
         no error. A silent null is the worst of the four states because it
         looks identical to "this feature was never built". */
      try {
        const { data, error } = await supabase
          .from("bike_systems")
          .select("slug, name, city, lat, lon")
          .ilike("city", destination.trim())
          .maybeSingle();
        if (cancelled) return;
        if (error) setLookupError(error.message);
        setSystem(data ?? null);
      } catch (e) {
        if (!cancelled) setLookupError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, destination]);

  const loadFollowed = useCallback(async () => {
    if (!supabase || !system) return;
    const { data: follows } = await supabase
      .from("station_follows")
      .select("station_id")
      .eq("system_slug", system.slug);

    const ids = (follows ?? []).map((f) => f.station_id);
    if (ids.length === 0) {
      setFollowed([]);
      return;
    }
    const { data } = await supabase
      .from("stations")
      .select(SELECT)
      .eq("system_slug", system.slug)
      .in("station_id", ids);
    setFollowed((data ?? []).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")));
  }, [supabase, system]);

  const loadRuns = useCallback(async () => {
    if (!supabase) return;
    const { data: latest } = await supabase
      .from("worker_runs")
      .select("started_at, ok, rows_changed, error")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: ok } = await supabase
      .from("worker_runs")
      .select("started_at, ok, rows_changed, error")
      .eq("ok", true)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLatestRun(latest ?? null);
    setLastOkRun(ok ?? null);
  }, [supabase]);

  useEffect(() => {
    void loadFollowed();
    void loadRuns();
  }, [loadFollowed, loadRuns]);

  /* Realtime. Three things have to line up for this to deliver anything — the
     table in the publication, read access, and an RLS policy that lets this
     person read the row — and when one is missing it fails silently. If the
     numbers stop moving, check those three before debugging here. */
  useEffect(() => {
    if (!supabase || !system || !session) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let refresh: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      /**
       * Authenticate the socket *before* subscribing, and keep it authenticated.
       *
       * Postgres Changes only delivers rows the subscriber is allowed to read,
       * so the websocket has to carry the Clerk token or every policy matches
       * nothing and the channel goes quiet with no error anywhere.
       *
       * supabase-js does call `realtime.setAuth` once, in the constructor, as a
       * floating promise — so a subscribe that happens first races it. Worse,
       * that is the *only* time it fires under third-party auth: the refresh
       * path hangs off Supabase's own auth events, which Clerk never emits. A
       * Clerk session token lives about a minute, so the socket would go stale
       * and silently stop delivering. Hence the explicit set, and the interval.
       */
      const token = await session.getToken();
      if (cancelled) return;
      if (token) supabase.realtime.setAuth(token);

      channel = supabase
        .channel(`live-${system.slug}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "stations",
            filter: `system_slug=eq.${system.slug}`,
          },
          (payload) => {
            const row = payload.new as Station;
            setFollowed((prev) =>
              prev.some((s) => s.station_id === row.station_id)
                ? prev.map((s) => (s.station_id === row.station_id ? { ...s, ...row } : s))
                : prev,
            );
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "worker_runs" },
          () => void loadRuns(),
        )
        .subscribe((status) => {
          /* A channel that cannot authenticate reports CHANNEL_ERROR and then
             says nothing ever again. Refetching on a reconnect also closes the
             gap for anything that changed while the socket was down. */
          if (status === "SUBSCRIBED") {
            void loadFollowed();
            void loadRuns();
          }
        });

      refresh = setInterval(async () => {
        const next = await session.getToken();
        if (next) supabase.realtime.setAuth(next);
      }, 45_000);
    })();

    return () => {
      cancelled = true;
      if (refresh) clearInterval(refresh);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, system, session, loadRuns, loadFollowed]);

  /**
   * Finding stations by *where you're staying*, not by station name.
   *
   * Asking for a station name assumed you already knew Divvy's naming, which
   * nobody visiting a city does. So the typed text goes to the geocoder first
   * — "Wicker Park", "Logan Square", a hotel's street — and the stations come
   * back ordered by how far they are from it.
   *
   * Street names still work, because the fallback is the old name match. Type
   * "Clark St" and the geocoder finds nothing useful, so it searches names
   * instead. One field, both behaviours, no mode switch to explain.
   */
  useEffect(() => {
    const q = query.trim();
    if (!supabase || !system || q.length < 2) {
      setMatches([]);
      setNear(null);
      return;
    }
    let cancelled = false;

    const t = setTimeout(async () => {
      const centre =
        system.lat !== null && system.lon !== null
          ? { lat: system.lat, lon: system.lon }
          : null;

      /* Geocode first, on the server. Skipped entirely if we have no centre
         to disambiguate against — a worldwide match would be worse than none. */
      if (centre) {
        try {
          const res = await fetch(
            `/api/place?q=${encodeURIComponent(q)}&lat=${centre.lat}&lon=${centre.lon}`,
          );
          if (cancelled) return;
          if (res.ok) {
            const { places } = (await res.json()) as {
              places: { lat: number; lon: number; label: string }[];
            };
            const hit = places[0];
            /* Guard against a same-named place on another continent winning
               by default: anything over 60km from the system centre is not
               the neighbourhood this person meant. */
            if (hit && metresBetween(centre, hit) < 60_000) {
              const d = 0.016; // ~1.8km box, trimmed to the nearest few below
              const { data } = await supabase
                .from("stations")
                .select(SELECT)
                .eq("system_slug", system.slug)
                .gte("lat", hit.lat - d)
                .lte("lat", hit.lat + d)
                .gte("lon", hit.lon - d)
                .lte("lon", hit.lon + d)
                .limit(80);
              if (cancelled) return;
              const sorted = (data ?? [])
                .filter((s) => s.lat !== null && s.lon !== null)
                .sort(
                  (a, b) =>
                    metresBetween(hit, { lat: a.lat!, lon: a.lon! }) -
                    metresBetween(hit, { lat: b.lat!, lon: b.lon! }),
                )
                .slice(0, 6);
              if (sorted.length > 0) {
                setNear({ label: hit.label, lat: hit.lat, lon: hit.lon });
                setMatches(sorted);
                return;
              }
            }
          }
        } catch {
          /* Geocoder unreachable is not a dead end — fall through to names. */
        }
      }

      const { data } = await supabase
        .from("stations")
        .select(SELECT)
        .eq("system_slug", system.slug)
        .ilike("name", `%${q}%`)
        .limit(6);
      if (cancelled) return;
      setNear(null);
      setMatches(data ?? []);
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [supabase, system, query]);

  async function follow(station: Station) {
    if (!supabase || !system || !userId) return;
    setQuery("");
    setMatches([]);
    /* Optimistic, like every other write in this app — a round trip before the
       row appears would make following feel broken. */
    setFollowed((prev) =>
      prev.some((s) => s.station_id === station.station_id)
        ? prev
        : [...prev, station].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    );
    await supabase.from("station_follows").insert({
      user_id: userId,
      system_slug: system.slug,
      station_id: station.station_id,
    });
    void loadFollowed();
  }

  async function unfollow(station: Station) {
    if (!supabase || !system) return;
    setFollowed((prev) => prev.filter((s) => s.station_id !== station.station_id));
    await supabase
      .from("station_follows")
      .delete()
      .eq("system_slug", system.slug)
      .eq("station_id", station.station_id);
  }

  /* Signed out is the one case that renders nothing, because signed out there
     is nobody whose stations these would be. Every other case says something. */
  if (!supabase) return null;

  if (!resolved) {
    return (
      <section className="mt-6">
        <SectionRule />
        <p className="mt-3 text-small text-muted">Checking for bikes…</p>
      </section>
    );
  }

  if (lookupError) {
    return (
      <section className="mt-6">
        <SectionRule />
        <p className="mt-3 border-l-[3px] border-error bg-error/10 px-3 py-1.5 text-small text-error">
          Couldn&rsquo;t check for bikes here. {lookupError}
        </p>
      </section>
    );
  }

  /* Designed absence, not an error and not a blank. A third of the starter
     trips land here — Lisbon has no seeded system — so this is a main path. */
  if (!system) {
    return (
      <section className="mt-6">
        <SectionRule />
        <p className="mt-3 text-small text-muted">
          No bikeshare system in {destination} yet. Chicago, New York, Boston,
          Washington and San Francisco are covered.
        </p>
      </section>
    );
  }

  /* Counted after the filter, not before. Saying "nearest 6" above a list of
     five — because one is already followed — is a small lie, and it is the
     kind a reader notices immediately. */
  const unfollowedMatches = matches.filter(
    (m) => !followed.some((f) => f.station_id === m.station_id),
  );

  const state: Freshness = freshnessOf(latestRun, lastOkRun);

  return (
    <section className="mt-6">
      <SectionRule />
      {/* Folded away by default. Each planned day already shows the dock next
          to it, which is the answer most people want; this is the longer
          version for a hotel that isn't on the itinerary. Three stacked
          destination panels above a packing list was too much page before you
          reached what the app is for.

          A <details> rather than a custom toggle: it is keyboard-operable and
          screen-reader-labelled for free, and <summary> is not one of the raw
          controls the component rule forbids. */}
      <details className="group mt-3">
        <summary className="cursor-pointer list-none">
          <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Label>
              <span className="underline decoration-rule-strong underline-offset-4">
                Follow other stations in {system.city}
              </span>
            </Label>
            <Label>{system.name}</Label>
          </span>
        </summary>

      <FreshnessLine state={state} line={freshnessLine(state, lastOkRun)} />

      {followed.length > 0 ? (
        <ul className="mt-3 border border-rule-strong bg-surface shadow-raised">
          {followed.map((s) => (
            <li
              key={s.station_id}
              className="flex items-baseline justify-between gap-4 border-b border-rule px-3 py-2 last:border-b-0"
            >
              <span className="text-ink">{s.name ?? s.station_id}</span>
              <span className="flex items-baseline gap-3">
                <span
                  className={state === "fresh" ? "text-ink" : "text-muted"}
                >
                  {countsLabel(s)}
                </span>
                <QuietAction
                  onClick={() => void unfollow(s)}
                  label={`Stop following ${s.name ?? s.station_id}`}
                >
                  Stop
                </QuietAction>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-small text-muted">
          Follow the stations near where you&rsquo;re staying and they&rsquo;ll
          update themselves.
        </p>
      )}

      <div className="mt-3 max-w-sm">
        <Field
          label="Where are you staying?"
          hint="A neighbourhood, a street, or a station name."
        >
          {(props) => (
            <TextInput
              {...props}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Wicker Park"
            />
          )}
        </Field>
        <SuggestionList
          items={unfollowedMatches}
          getKey={(s) => s.station_id}
          onPick={(s) => void follow(s)}
        >
          {(s) => (
            <span className="flex items-baseline justify-between gap-3">
              <span>{s.name ?? s.station_id}</span>
              {near && s.lat !== null && s.lon !== null && (
                <span className="text-muted">
                  {distanceLabel(metresBetween(near, { lat: s.lat, lon: s.lon }))}
                </span>
              )}
            </span>
          )}
        </SuggestionList>
        {near && unfollowedMatches.length > 0 && (
          <p className="mt-1 text-small text-muted">
            Nearest {unfollowedMatches.length} to {near.label}
          </p>
        )}
      </div>
      </details>
    </section>
  );
}

/**
 * Per the design system, a problem is a rule, an icon and a tint — never an
 * accent-coloured anything. The accent belongs to the primary action alone.
 */
function FreshnessLine({ state, line }: { state: Freshness; line: string }) {
  if (state === "stale") {
    return (
      <p className="mt-2 border-l-[3px] border-warning bg-warning/10 px-3 py-1.5 text-small text-warning">
        {line}
      </p>
    );
  }
  if (state === "down") {
    return (
      <p className="mt-2 border-l-[3px] border-error bg-error/10 px-3 py-1.5 text-small text-error">
        {line}
      </p>
    );
  }
  return <p className="mt-2 text-small text-muted">{line}</p>;
}
