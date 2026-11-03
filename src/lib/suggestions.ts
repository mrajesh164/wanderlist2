/**
 * Building a packing list from three things we actually know:
 *   1. how long the trip is          → quantities
 *   2. what the weather does there    → outerwear, rain gear, sun gear
 *      that month (from the hardcoded climate table)
 *   3. what you learned last time     → things to drop, things to add
 *
 * Every item records *why* it's on the list, so the UI can explain itself
 * instead of looking like magic.
 */

import type { Conditions } from "./climate";
import type {
  Item,
  ItemCategory,
  ItemSource,
  KitItem,
  WhenTag,
} from "./types";

type Spec = {
  label: string;
  category: ItemCategory;
  source: ItemSource;
  qty?: number;
};

function makeItem(spec: Spec): Item {
  return {
    id: crypto.randomUUID(),
    label: spec.label,
    qty: spec.qty ?? 1,
    category: spec.category,
    source: spec.source,
    packed: false,
  };
}

/** Nights away, inclusive of both dates; always at least 1. */
export function tripLengthDays(start: string, end: string): number {
  const a = Date.parse(start + "T00:00:00");
  const b = Date.parse(end + "T00:00:00");
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** The calendar months a trip touches, as 0-based indexes. */
export function monthsSpanned(start: string, end: string): number[] {
  const a = new Date(start + "T00:00:00");
  const b = new Date(end + "T00:00:00");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return [0];
  const out = new Set<number>();
  const cursor = new Date(a);
  // Walk month by month so a trip spanning a boundary reports both.
  while (cursor <= b) {
    out.add(cursor.getMonth());
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }
  out.add(b.getMonth());
  return [...out];
}

/**
 * Where clothing counts stop growing, because past this you do laundry rather
 * than carry more. Underwear and socks are `capped + 1`, tops `capped`, so a
 * ten-day trip and a three-week trip both ask for eleven pairs of socks.
 *
 * Exported because the trip page says so out loud when it binds. That sentence
 * exists because the number looks broken otherwise: move a trip from twelve
 * days to fifteen, watch "Trousers 4" become 5 while "Underwear 11" sits still,
 * and the obvious conclusion is that the rebuild is buggy. It isn't — but a
 * rule nobody states is indistinguishable from a bug. Keep the constant and the
 * copy wired together; a cap of 10 mentioned as "ten days" in prose is exactly
 * the pair that drifts.
 */
export const LAUNDRY_CAP_DAYS = 10;

/** A weekend is short and lands on one. */
const WEEKEND_MAX_DAYS = 4;
/** Past this a trip is "long", which is also where the laundry cap bites. */
const LONG_MIN_DAYS = LAUNDRY_CAP_DAYS;

/**
 * Which `WhenTag`s describe this trip.
 *
 * Every tag has to be decidable from what a trip already carries — the climate
 * normals the list is built from, and the dates. That constraint is what keeps
 * the vocabulary closed: a tag the app can't evaluate would never fire, and an
 * item filed under it would silently never appear.
 */
export function tagsForTrip(
  conditions: Conditions,
  days: number,
  startDate?: string,
): WhenTag[] {
  const tags: WhenTag[] = [];
  if (conditions.band === "freezing" || conditions.band === "cold") tags.push("cold");
  if (conditions.band === "warm" || conditions.band === "hot") tags.push("hot");
  if (conditions.wetness === "wet" || conditions.wetness === "some-rain") tags.push("wet");

  if (days <= WEEKEND_MAX_DAYS && startDate) {
    /* Built with an explicit T00:00:00 like everywhere else in the app: a bare
       date string parses as UTC midnight, which in any negative offset is the
       day before, and a Saturday trip would read as a Friday. */
    const start = new Date(startDate + "T00:00:00");
    const spans = [...Array(days)].some((_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d.getDay() === 0 || d.getDay() === 6;
    });
    if (spans) tags.push("weekend");
  }
  if (days >= LONG_MIN_DAYS) tags.push("long");
  return tags;
}

export function buildPackingList(
  conditions: Conditions,
  days: number,
  learned: { drop: string[]; add: string[] } = { drop: [], add: [] },
  /** Your inventory, so things you've said when you need get added here. */
  kit: KitItem[] = [],
  startDate?: string,
): Item[] {
  const specs: Spec[] = [];

  /* --- every trip, regardless --- */
  specs.push(
    { label: "Wallet and ID", category: "Documents", source: "essential" },
    { label: "Phone charger", category: "Tech", source: "essential" },
    { label: "Keys", category: "Documents", source: "essential" },
    { label: "Toothbrush", category: "Toiletries", source: "essential" },
    { label: "Toothpaste", category: "Toiletries", source: "essential" },
    { label: "Deodorant", category: "Toiletries", source: "essential" },
  );

  /* --- quantities from the trip length --- */
  const capped = Math.min(days, LAUNDRY_CAP_DAYS);
  specs.push(
    {
      label: "Underwear",
      category: "Clothing",
      source: "duration",
      qty: capped + 1,
    },
    { label: "Socks", category: "Clothing", source: "duration", qty: capped + 1 },
    { label: "Tops", category: "Clothing", source: "duration", qty: capped },
    {
      label: "Trousers or skirts",
      category: "Clothing",
      source: "duration",
      qty: Math.max(1, Math.ceil(days / 3)),
    },
  );
  if (days >= 5) {
    specs.push({
      label: "Laundry bag",
      category: "Extras",
      source: "duration",
    });
  }
  if (days >= 3) {
    specs.push({
      label: "Pajamas",
      category: "Clothing",
      source: "duration",
    });
  }

  /* --- the weather there, that month --- */
  switch (conditions.band) {
    case "freezing":
      specs.push(
        { label: "Heavy winter coat", category: "Outerwear", source: "climate" },
        { label: "Thermal base layer", category: "Clothing", source: "climate", qty: 2 },
        { label: "Warm hat", category: "Outerwear", source: "climate" },
        { label: "Gloves", category: "Outerwear", source: "climate" },
        { label: "Scarf", category: "Outerwear", source: "climate" },
        { label: "Wool socks", category: "Clothing", source: "climate", qty: 2 },
        { label: "Insulated boots", category: "Footwear", source: "climate" },
      );
      break;
    case "cold":
      specs.push(
        { label: "Warm coat", category: "Outerwear", source: "climate" },
        { label: "Sweater", category: "Clothing", source: "climate", qty: 2 },
        { label: "Warm hat", category: "Outerwear", source: "climate" },
        { label: "Gloves", category: "Outerwear", source: "climate" },
        { label: "Closed shoes", category: "Footwear", source: "climate" },
      );
      break;
    case "cool":
      specs.push(
        { label: "Jacket", category: "Outerwear", source: "climate" },
        { label: "Sweater", category: "Clothing", source: "climate" },
        { label: "Long-sleeve layer", category: "Clothing", source: "climate", qty: 2 },
        { label: "Closed shoes", category: "Footwear", source: "climate" },
      );
      break;
    case "mild":
      specs.push(
        { label: "Light jacket", category: "Outerwear", source: "climate" },
        { label: "Walking shoes", category: "Footwear", source: "climate" },
      );
      break;
    case "warm":
      specs.push(
        { label: "Sunglasses", category: "Extras", source: "climate" },
        { label: "Sunscreen", category: "Toiletries", source: "climate" },
        { label: "Light layer for evenings", category: "Clothing", source: "climate" },
        { label: "Walking shoes", category: "Footwear", source: "climate" },
      );
      break;
    case "hot":
      specs.push(
        { label: "Sunscreen", category: "Toiletries", source: "climate" },
        { label: "Sun hat", category: "Extras", source: "climate" },
        { label: "Sunglasses", category: "Extras", source: "climate" },
        { label: "Sandals", category: "Footwear", source: "climate" },
        { label: "Refillable water bottle", category: "Extras", source: "climate" },
      );
      break;
  }

  /* --- rain --- */
  if (conditions.wetness === "wet") {
    specs.push(
      { label: "Rain shell", category: "Outerwear", source: "climate" },
      { label: "Waterproof shoes", category: "Footwear", source: "climate" },
      { label: "Compact umbrella", category: "Extras", source: "climate" },
    );
  } else if (conditions.wetness === "some-rain") {
    specs.push({
      label: "Compact umbrella",
      category: "Extras",
      source: "climate",
    });
  }

  /* --- a freezing low is a different problem from a cold day --- */
  if (conditions.freezes && conditions.band !== "freezing") {
    specs.push({ label: "Lip balm", category: "Toiletries", source: "climate" });
  }

  /* --- what you learned last time --- */
  for (const label of learned.add) {
    specs.push({ label, category: "Extras", source: "learned" });
  }

  /* --- what you've said about your own things ---
     An item marked "always" goes on every list. One tagged with a condition
     goes on the lists that match. This is the feedback about weather and
     scenarios made load-bearing rather than decorative: tag the umbrella
     "when it rains" once and you stop re-adding it to every wet trip. */
  const tripTags = new Set(tagsForTrip(conditions, days, startDate));
  for (const entry of kit) {
    const matches =
      entry.alwaysNeeded ||
      (entry.whenTags ?? []).some((t) => tripTags.has(t));
    if (!matches) continue;
    specs.push({
      label: entry.label,
      category: entry.category,
      source: "learned",
      qty: entry.qty,
    });
  }

  /* De-duplicate by label, keeping the larger quantity, then drop anything the
     last trip taught us we don't use. */
  const dropped = new Set(learned.drop.map((d) => d.toLowerCase()));
  const byLabel = new Map<string, Spec>();
  for (const spec of specs) {
    const key = spec.label.toLowerCase();
    if (dropped.has(key)) continue;
    const existing = byLabel.get(key);
    if (!existing) {
      byLabel.set(key, spec);
    } else if ((spec.qty ?? 1) > (existing.qty ?? 1)) {
      byLabel.set(key, spec);
    }
  }

  return [...byLabel.values()].map(makeItem);
}

/** Short explanation of why the list looks the way it does. */
export function explainList(conditions: Conditions, days: number): string {
  const nights = days === 1 ? "a single day" : `${days} days`;
  const weather =
    conditions.wetness === "dry"
      ? "and it's usually dry"
      : conditions.wetness === "wet"
        ? "and it rains often"
        : "and there's usually some rain";
  return `Built for ${nights}, where it's typically ${Math.round(conditions.highC)}°C by day ${weather}.`;
}
