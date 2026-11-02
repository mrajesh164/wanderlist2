"use client";

import { useEffect, useState } from "react";
import { Label, SectionRule } from "./Card";
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
  const [stations, setStations] = useState<Station[]>([]);

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

  if (plan.length === 0) return null;

  return (
    <section className="mt-6">
      <SectionRule />
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Label>Your days</Label>
        <Label>Built from the forecast</Label>
      </div>

      <ol className="mt-3 border border-rule">
        {plan.map((day) => (
          <li
            key={day.date.toISOString()}
            className="border-b border-rule px-3 py-3 last:border-b-0"
          >
            <DayRow day={day} stations={stations} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function DayRow({ day, stations }: { day: PlannedDay; stations: Station[] }) {
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

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <span className="flex min-w-0 flex-col">
        <span className="text-ink">
          <span className="font-semibold">
            {day.date.toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
            })}
          </span>{" "}
          · {day.place.title}
        </span>
        <span className="text-small text-muted">
          {day.place.area}
          {why && ` · ${why}`}
        </span>
      </span>

      {nearest && (
        <span className="text-small text-muted">
          {nearest.station.name ?? "Nearest dock"} ·{" "}
          {distanceLabel(nearest.metres)}
          {nearest.station.bikes_available !== null && (
            <> · {countsLabel(nearest.station)}</>
          )}
        </span>
      )}
    </div>
  );
}
