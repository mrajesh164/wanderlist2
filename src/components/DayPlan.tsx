"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession, useUser } from "@clerk/nextjs";
import { Label } from "./Card";
import { TripSection } from "./TripSection";
import { useSupabase } from "@/lib/supabase";
import { buildItinerary, reasonLine, type PlannedDay } from "@/lib/itinerary";
import {
  countsLabel,
  COUNTS_EXPLAINER,
  distanceLabel,
  metresBetween,
  type Station,
} from "@/lib/stations";
import type { TripDay } from "@/lib/trip-days";

/**
 * Where you'll be each day, and how you'd get there.
 *
 * This is the piece that makes the live layer part of the app rather than a
 * panel beside it. The weather already decides what to pack; here it also
 * decides where to spend each day, and the bikes are scoped to *that day's
 * neighbourhood* instead of the whole city — which is the difference between
 * "some stations in Chicago" and "how you get to Tuesday".
 *
 * Nothing is stored. The plan is a function of the trip, so it survives a
 * reload without a table behind it, and a trip taken again next year
 * regenerates against next year's dates.
 */

const SELECT =
  "system_slug, station_id, name, lat, lon, capacity, bikes_available, ebikes_available, docks_available, last_reported, updated_at";

/** Close enough to walk to from the day's plan. */
const NEAR_METRES = 900;

export function DayPlan({
  citySlug,
  days,
}: {
  /** Serves double duty: the curated place list, and the bikeshare system.
   *  They share a slug space on purpose, so a city with places but no bikes
   *  (Lisbon) just returns no stations rather than needing a special case. */
  citySlug: string | null;
  days: TripDay[];
}) {
  const supabase = useSupabase();
  const { user } = useUser();
  const { session } = useSession();
  const [stations, setStations] = useState<Station[]>([]);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [reloadTick, setReloadTick] = useState(0);

  /* Memoised on the dates rather than the array, which is rebuilt on every
     render: without this the plan is a new object each time and every effect
     keyed on it re-runs forever. */
  const daysKey = days.map((d) => d.date.toISOString()).join("|");
  const plan = useMemo(
    () => buildItinerary(citySlug, days),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- daysKey is `days`
    [citySlug, daysKey],
  );

  /* The dock each planned day would actually use. Computed here rather than
     in the row so the registration effect and the rows agree on one answer. */
  const nearestFor = (place: { lat: number; lon: number }) =>
    stations
      .filter((s) => s.lat !== null && s.lon !== null)
      .map((s) => ({ station: s, metres: metresBetween(place, { lat: s.lat!, lon: s.lon! }) }))
      .filter((x) => x.metres <= NEAR_METRES)
      .sort((a, b) => a.metres - b.metres)[0];

  const needed = plan
    .map((d) => nearestFor(d.place)?.station.station_id)
    .filter((id): id is string => Boolean(id));

  /* Extracted so the dependency array holds a plain value the linter can
     check, rather than an expression it has to evaluate. */
  const neededKey = needed.join("|");

  /* One query for the whole trip, not one per day. A handful of areas in the
     same city sit inside one bounding box, and filtering the rest out in JS is
     cheaper than three round trips. */
  useEffect(() => {
    /* No synchronous setState on the early return: there is nothing to clear,
       because a component with no plan renders nothing anyway, and clearing
       here is what the lint rule means by a cascading render. */
    if (!supabase || !citySlug || plan.length === 0) return;
    let cancelled = false;
    const lats = plan.map((d) => d.place.lat);
    const lons = plan.map((d) => d.place.lon);
    const pad = 0.012;

    (async () => {
      const { data } = await supabase
        .from("stations")
        .select(SELECT)
        .eq("system_slug", citySlug)
        .gte("lat", Math.min(...lats) - pad)
        .lte("lat", Math.max(...lats) + pad)
        .gte("lon", Math.min(...lons) - pad)
        .lte("lon", Math.max(...lons) + pad)
        .limit(400);
      if (!cancelled) setStations(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
    /* Keyed on the places rather than the array identity, which is rebuilt
       on every render because the plan is derived rather than stored. */
  }, [supabase, citySlug, plan]);

  /**
   * Keep the day rows live too.
   *
   * This was missing and it looked like a bug in the worker: tapping Watch
   * flipped the row to its followed state, the worker wrote real counts
   * twenty seconds later, and the row sat there showing a dash because
   * nothing told it. StationBoard subscribed; this didn't.
   *
   * Same shape as StationBoard's, including authenticating the socket before
   * subscribing and refreshing the token — Postgres Changes only delivers
   * rows the subscriber may read, and a Clerk token lasts about a minute.
   */
  useEffect(() => {
    if (!supabase || !citySlug || !session) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let refresh: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      const token = await session.getToken();
      if (cancelled) return;
      if (token) supabase.realtime.setAuth(token);

      channel = supabase
        .channel(`days-${citySlug}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "stations",
            filter: `system_slug=eq.${citySlug}`,
          },
          (payload) => {
            const row = payload.new as Station;
            setStations((prev) =>
              prev.map((s) =>
                s.station_id === row.station_id ? { ...s, ...row } : s,
              ),
            );
          },
        )
        .subscribe();

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
  }, [supabase, citySlug, session]);

  /* Read inside the effect rather than through a useCallback the effect then
     calls: the lint rule cannot see past the indirection and reads it as a
     synchronous setState. `reloadTick` is what the registration below bumps
     to ask for a re-read. */
  useEffect(() => {
    if (!supabase || !citySlug) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("station_follows")
        .select("station_id")
        .eq("system_slug", citySlug);
      if (!cancelled) {
        setFollowed(new Set((data ?? []).map((f) => f.station_id)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, citySlug, reloadTick]);

  /**
   * Register the docks this itinerary needs, without asking.
   *
   * The worker only polls stations somebody follows — that restraint is what
   * keeps writes at 3% of the feed — but making the *user* perform that
   * subscription was leaking an implementation detail into the interface.
   * Nobody arrives wanting to watch a dock. They want to know whether they
   * can bike to Tuesday.
   *
   * So the itinerary registers its own docks: at most one per day, three for
   * a long weekend, and only for days that actually have one within walking
   * distance. `ignoreDuplicates` means a reload is a no-op rather than a
   * conflict, and anything followed by hand still shows up the same way.
   */
  useEffect(() => {
    if (!supabase || !citySlug || !user || needed.length === 0) return;
    const missing = needed.filter((id) => !followed.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      await supabase.from("station_follows").upsert(
        missing.map((station_id) => ({
          user_id: user.id,
          system_slug: citySlug,
          station_id,
        })),
        { onConflict: "user_id,system_slug,station_id", ignoreDuplicates: true },
      );
      if (!cancelled) setReloadTick((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- neededKey is `needed`
  }, [supabase, citySlug, user, neededKey, followed]);

  if (plan.length === 0) return null;

  return (
    <TripSection
      title="Your days"
      meta="Built from the forecast"
      note={COUNTS_EXPLAINER}
    >
      <ol className="border border-rule-strong bg-surface shadow-raised">
        {plan.map((day) => (
          <li
            key={day.date.toISOString()}
            className="border-b border-rule px-3 py-3 last:border-b-0"
          >
            <DayRow day={day} nearest={nearestFor(day.place)} />
          </li>
        ))}
      </ol>
    </TripSection>
  );
}

function DayRow({
  day,
  nearest,
}: {
  day: PlannedDay;
  nearest?: { station: Station; metres: number };
}) {
  const why = reasonLine(day);
  const weekday = day.date.toLocaleDateString(undefined, { weekday: "short" });

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
      <span className="min-w-0 flex-1">
        <Label>
          {weekday} {day.date.getDate()}
        </Label>
        <p className="mt-1 text-body font-semibold text-ink">
          {day.place.title}
          <span className="font-normal text-muted"> · {day.place.area}</span>
        </p>
        <p className="measure mt-1 text-body text-ink">{day.place.note}</p>
        <p className="measure mt-1 text-small italic text-muted">
          {day.place.tip}
        </p>
        {why && <p className="mt-1 text-small text-warning">{why}</p>}
      </span>

      {nearest && (
        /* "Getting there" rather than "nearest bikes": the label should say
           why this is on the page, not just what it is. And the number is
           the whole point, so it carries the weight. */
        <span className="shrink-0 text-right">
          <Label>Getting there</Label>
          <p className="mt-1 text-body font-semibold text-ink">
            {nearest.station.bikes_available === null
              ? "counting…"
              : countsLabel(nearest.station)}
          </p>
          <p className="text-small text-muted">
            {nearest.station.name ?? "Dock"} · {distanceLabel(nearest.metres)}
          </p>
        </span>
      )}
    </div>
  );
}
