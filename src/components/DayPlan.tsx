"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Label, SectionRule } from "./Card";
import { QuietAction } from "./Controls";
import { useSupabase } from "@/lib/supabase";
import { buildItinerary, reasonLine, type PlannedDay } from "@/lib/itinerary";
import {
  countsLabel,
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
  const [stations, setStations] = useState<Station[]>([]);
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  const plan = buildItinerary(citySlug, days);

  /* One query for the whole trip, not one per day. A handful of areas in the
     same city sit inside one bounding box, and filtering the rest out in JS is
     cheaper than three round trips. */
  useEffect(() => {
    if (!supabase || !citySlug || plan.length === 0) {
      setStations([]);
      return;
    }
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
  }, [supabase, citySlug, plan.map((d) => d.place.area).join("|")]);

  const reload = useCallback(async () => {
    if (!supabase || !citySlug) return;
    const { data } = await supabase
      .from("station_follows")
      .select("station_id")
      .eq("system_slug", citySlug);
    setFollowed(new Set((data ?? []).map((f) => f.station_id)));
  }, [supabase, citySlug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Watching a day's dock is what makes that day live.
   *
   * The worker only polls stations somebody follows — that is what keeps the
   * write volume at 3% of the feed — so a planned day shows a dock and a
   * distance but no numbers until someone asks for them. One tap here is the
   * ask, and the counts arrive on the next run, at most thirty seconds later.
   */
  async function watch(station: Station) {
    if (!supabase || !citySlug || !user) return;
    setFollowed((prev) => new Set(prev).add(station.station_id));
    await supabase.from("station_follows").insert({
      user_id: user.id,
      system_slug: citySlug,
      station_id: station.station_id,
    });
    void reload();
  }

  if (plan.length === 0) return null;

  return (
    <section className="mt-6">
      <SectionRule />
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Label>Your days</Label>
        <Label>Built from the forecast</Label>
      </div>

      <ol className="mt-3 border border-rule-strong bg-surface shadow-raised">
        {plan.map((day) => (
          <li
            key={day.date.toISOString()}
            className="border-b border-rule px-3 py-3 last:border-b-0"
          >
            <DayRow
              day={day}
              stations={stations}
              followed={followed}
              onWatch={watch}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function DayRow({
  day,
  stations,
  followed,
  onWatch,
}: {
  day: PlannedDay;
  stations: Station[];
  followed: Set<string>;
  onWatch: (s: Station) => void;
}) {
  const why = reasonLine(day);

  /* The nearest station to *this* day's place, with live counts if the worker
     has written any. Everything outside walking distance is not an answer to
     "how do I get there", so it is left out rather than shown faintly. */
  const nearest = stations
    .filter((s) => s.lat !== null && s.lon !== null)
    .map((s) => ({
      station: s,
      metres: metresBetween(day.place, { lat: s.lat!, lon: s.lon! }),
    }))
    .filter((x) => x.metres <= NEAR_METRES)
    .sort((a, b) => a.metres - b.metres)[0];

  /* Weekday and date built separately rather than from one toLocaleDateString
     call, which put the number first — "1 Sun" reads as a list index followed
     by a day. This matches the conditions strip directly above, which already
     labels its cells SUN 1. */
  const weekday = day.date.toLocaleDateString(undefined, { weekday: "short" });

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
      <span className="min-w-0 flex-1">
        <Label>
          {weekday} {day.date.getDate()}
        </Label>
        <p className="mt-1 text-body text-ink">
          {day.place.title}
          <span className="text-muted"> · {day.place.area}</span>
        </p>
        <p className="measure mt-0.5 text-small text-muted">{day.place.note}</p>
        <p className="measure mt-1 text-small italic text-muted">
          {day.place.tip}
        </p>
        {why && (
          <p className="mt-1 text-small text-warning">{why}</p>
        )}
      </span>

      {nearest && (
        /* Labelled, because an unexplained street name and a distance on the
           right of a row is a riddle. The label says what it is; the line
           below says where and how far; the action says what you can do. */
        <span className="shrink-0 text-right">
          <Label>Nearest bikes</Label>
          <p className="mt-1 text-small text-ink">
            {nearest.station.name ?? "Dock"}
          </p>
          <p className="text-small text-muted">
            {distanceLabel(nearest.metres)}
            {" · "}
            {followed.has(nearest.station.station_id) ? (
              <span className="text-ink">{countsLabel(nearest.station)}</span>
            ) : (
              <QuietAction
                onClick={() => onWatch(nearest.station)}
                label={`Watch ${nearest.station.name ?? "this dock"} for live bikes`}
                className="opacity-100 underline decoration-rule-strong underline-offset-2 hover:text-ink"
              >
                Watch
              </QuietAction>
            )}
          </p>
        </span>
      )}
    </div>
  );
}
