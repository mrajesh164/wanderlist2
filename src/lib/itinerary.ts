/**
 * A plan for each day of a trip, built the same way the packing list is.
 *
 * This is what stops the live layer reading as a widget bolted onto a packing
 * app. The destination already decides what the weather does; now it also
 * decides where you'll be each day, and the bikes panel can answer "how do I
 * get to Thursday's plan" rather than "here are some stations in this city".
 *
 * Generated, not authored. The same trip always produces the same plan, but
 * move the dates and it changes, because the weather it is reading changes.
 *
 * Pure, no React, no network — `places.ts` holds coordinates resolved once by
 * hand, and `tripDays` has already paired each date with its normals.
 */

import type { Place } from "./places";
import { placesFor } from "./places";
import type { TripDay } from "./trip-days";

export type PlannedDay = {
  date: Date;
  place: Place;
  /** Why this one landed on this day — shown, because a plan you can't
   *  question is a plan you can't correct. */
  reason: "wet" | "cold" | "fine";
};

/**
 * A date is "wet" when more than a third of the sampled years saw rain on it.
 *
 * Deliberately coarse, for the same reason the conditions strip is: the
 * underlying figure is "4 of the last 15 December 10ths were wet", and
 * anything finer than wet / not-wet would be false precision dressed up as a
 * recommendation.
 */
const WET = 0.34;

/** Below this, an afternoon outdoors stops being a good idea. */
const COLD_C = 4;

/**
 * Pick somewhere for each day.
 *
 * Rules, in order:
 *   1. A wet or cold day takes an indoor place if one is left.
 *   2. A fine day takes an *outdoor* one if one is left.
 *   3. Otherwise take whatever is next.
 *   4. Never repeat until the list is exhausted — a three-day trip should not
 *      send you to the same neighbourhood twice when six are available.
 *
 * Rule 2 is not symmetry for its own sake, and leaving it out was a real bug:
 * with only the indoor rule, a fine Sunday took the museum simply because the
 * museum sorts first, and then a wet Tuesday had one fewer indoor option to
 * reach for. Indoor places are the scarce resource — spend them on the days
 * that need them.
 *
 * Longer trips than there are places will cycle, which is the honest outcome
 * of a curated list and better than inventing somewhere.
 */
export function buildItinerary(
  citySlug: string | null | undefined,
  days: TripDay[],
): PlannedDay[] {
  const all = placesFor(citySlug);
  if (all.length === 0 || days.length === 0) return [];

  const unused = [...all];
  const out: PlannedDay[] = [];

  for (const day of days) {
    if (unused.length === 0) unused.push(...all);

    const wet = day.normal.wetChance > WET;
    const cold = day.normal.highC < COLD_C;

    /* Either preference only fires if such a place is actually left; falling
       back to the next one beats repeating somewhere already visited. */
    const wanted = wet || cold;
    let index = unused.findIndex((p) => p.indoor === wanted);
    if (index === -1) index = 0;

    const [place] = unused.splice(index, 1);
    out.push({
      date: day.date,
      place: place!,
      reason: wet ? "wet" : cold ? "cold" : "fine",
    });
  }

  return out;
}

/** One short line saying why, in the app's voice rather than a rule dump. */
export function reasonLine(day: PlannedDay): string {
  switch (day.reason) {
    case "wet":
      return day.place.indoor ? "Rain likely — indoors" : "Rain likely";
    case "cold":
      return day.place.indoor ? "Cold — indoors" : "Cold";
    case "fine":
      return "";
  }
}
