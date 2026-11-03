/**
 * Starter trips for the first visit.
 *
 * The brief is explicit that a new person must get something useful immediately and
 * must not be dropped into an empty screen. So the first visit offers three ready-made
 * trips, and one tap builds a real one — real dates, a real packing list — which can be
 * edited afterwards. Nothing is asked for up front.
 *
 * Dates are relative to today so a starter is never stale.
 */

import { conditionsFor, findClimate } from "./climate";
import { buildPackingList, monthsSpanned } from "./suggestions";
import { todayISO } from "./trips";
import type { Trip } from "./types";

export type StarterKey = "weekend" | "warm" | "conference";

type Starter = {
  key: StarterKey;
  name: string;
  destination: string;
  climateSlug: string;
  /** Days from today to the start. */
  startIn: number;
  /** Nights, inclusive — a 3 means a three-day trip. */
  days: number;
};

export const STARTERS: Starter[] = [
  {
    key: "weekend",
    name: "A weekend at home",
    destination: "Chicago",
    climateSlug: "chicago",
    startIn: 5,
    days: 3,
  },
  {
    key: "warm",
    name: "A week somewhere warm",
    destination: "Lisbon",
    climateSlug: "lisbon",
    startIn: 30,
    days: 7,
  },
  {
    key: "conference",
    name: "Three days for a conference",
    destination: "New York",
    climateSlug: "new-york",
    startIn: 14,
    days: 3,
  },
];

export function findStarter(key: string | undefined): Starter | undefined {
  return STARTERS.find((s) => s.key === key);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** How long a starter's trip is, in words, for the card. */
export function starterDates(starter: Starter): {
  startDate: string;
  endDate: string;
} {
  const startDate = addDays(todayISO(), starter.startIn);
  return { startDate, endDate: addDays(startDate, starter.days - 1) };
}

/** Build a complete, usable trip from a starter. One tap, no questions. */
export function createStarterTrip(starter: Starter): Trip {
  const { startDate, endDate } = starterDates(starter);
  const climate = findClimate(starter.climateSlug);

  // Every starter names a destination that's in the table, so this is defined;
  // the fallback keeps the types honest rather than guarding a real case.
  const conditions = climate
    ? conditionsFor(climate, monthsSpanned(startDate, endDate))
    : undefined;

  return {
    id: crypto.randomUUID(),
    name: starter.name,
    destination: starter.destination,
    climateSlug: starter.climateSlug,
    startDate,
    endDate,
    stayingPlaces: [],
    items: conditions ? buildPackingList(conditions, starter.days) : [],
    createdAt: new Date().toISOString(),
    learned: { drop: [], add: [] },
  };
}
