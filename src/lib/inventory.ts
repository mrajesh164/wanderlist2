/**
 * Your kit, assembled from every trip you've taken.
 *
 * This isn't a second database of things you own — that would be a chore to
 * maintain and would go stale immediately. It's a *view* over the trips that
 * already exist: every item that has ever been on a list, how often it actually
 * went in the bag, and what the board has learned about it.
 *
 * It exists because the learning loop is otherwise invisible. Corrections live
 * inside individual trips, so there's no single place to see that you've
 * carried an umbrella on six trips and used it twice, or that laundry sheets
 * started as something you added by hand and are now standard. This is that
 * place.
 */

import type { ItemCategory, KitItem, Trip, WhenTag } from "./types";
import { phaseOf } from "./trips";

/**
 * Where a row's quantity came from. Every row has a number; they are not all
 * worth the same amount of trust, and the difference decides whether the number
 * is allowed to warn you about anything.
 *
 * - `counted`  — you set it: the stepper, an "x3" when adding, or the 1 that
 *                anything added through the inventory form starts at. True.
 * - `inferred` — the most you've ever actually packed at once. A floor: tick
 *                "Socks × 6" off a list and you demonstrably own six pairs.
 * - `assumed`  — 1, because it's been on a list but never ticked, so there's no
 *                evidence either way. Shown, never acted on.
 *
 * Only the first of those is a thing someone said. The 1 behind an `assumed`
 * row was chosen by nobody, which is why it never warns: a new person's first
 * trip asks for "Underwear × 8" against an empty inventory, and warning on
 * every such row before they've done anything would be the whole feature
 * crying wolf on day one.
 */
export type QtySource = "counted" | "inferred" | "assumed";

export type KitEntry = {
  label: string;
  category: ItemCategory;
  /** How many you own. Always present; see `qtySource` for how much to trust it. */
  qty: number;
  qtySource: QtySource;
  /** The largest quantity ever ticked off a list. 0 if it never has been. */
  packedMax: number;
  /** How many trips this has appeared on. */
  onTrips: number;
  /** How many times you actually checked it off. */
  packedTimes: number;
  /** How many finished trips it was on but never ticked. */
  unpackedOnFinished: number;
  /** You asked for this after a trip, so it's now suggested. */
  requested: boolean;
  /** You've told some trip to stop suggesting it. */
  dropped: boolean;
  /** You typed it in yourself rather than it being suggested. */
  yourOwn: boolean;
  /** Listed in your inventory directly, whether or not it's been packed. */
  owned: boolean;
  /** Id of the inventory entry, when there is one — lets it be removed. */
  kitId?: string;
  /** On every trip, regardless of conditions. */
  alwaysNeeded: boolean;
  /** Conditions that call for it — see WhenTag. */
  whenTags: WhenTag[];
  /** Most recent trip it appeared on. */
  lastSeenOn?: string;
};

/**
 * Resolve the one number a row shows, and say where it came from.
 *
 * The number is the greater of what you said and what you've proved, because
 * you cannot own fewer of something than you have packed at once. That matters
 * most for the count everything starts at: type "Socks", accept the 1, then
 * tick "Socks × 6" off a list, and the row corrects itself to 6 instead of
 * holding a stale number you set before you knew better. Nothing you've
 * demonstrated is ever silently overwritten by an older, smaller claim.
 */
function resolveQty(
  counted: number | undefined,
  packedMax: number,
): { qty: number; qtySource: QtySource } {
  if (counted !== undefined && counted >= packedMax) {
    return { qty: counted, qtySource: "counted" };
  }
  if (packedMax > 0) return { qty: packedMax, qtySource: "inferred" };
  return { qty: 1, qtySource: "assumed" };
}

export function buildInventory(trips: Trip[], kit: KitItem[] = []): KitEntry[] {
  const byLabel = new Map<string, KitEntry>();
  /** Counts you set explicitly, kept aside until every trip has been read. */
  const counted = new Map<string, number>();

  const touch = (label: string, category: ItemCategory): KitEntry => {
    const key = label.toLowerCase();
    let entry = byLabel.get(key);
    if (!entry) {
      entry = {
        label,
        category,
        qty: 1,
        qtySource: "assumed",
        packedMax: 0,
        onTrips: 0,
        packedTimes: 0,
        unpackedOnFinished: 0,
        requested: false,
        dropped: false,
        yourOwn: false,
        owned: false,
        kitId: undefined,
        alwaysNeeded: false,
        whenTags: [],
        lastSeenOn: undefined,
      };
      byLabel.set(key, entry);
    }
    return entry;
  };

  // Oldest first, so lastSeenOn ends up genuinely last.
  const chronological = [...trips].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );

  for (const trip of chronological) {
    const finished = phaseOf(trip) === "past";

    for (const item of trip.items) {
      const entry = touch(item.label, item.category);
      entry.onTrips += 1;
      entry.lastSeenOn = trip.name;
      if (item.packed) {
        entry.packedTimes += 1;
        /* Ticking a row off means the whole quantity went in the bag, so this
           is proof of ownership rather than a guess at it. */
        entry.packedMax = Math.max(entry.packedMax, item.qty);
      } else if (finished) entry.unpackedOnFinished += 1;
      if (item.source === "manual") entry.yourOwn = true;
      if (item.source === "learned") entry.requested = true;
    }

    /* Corrections can outlive the items themselves: something dropped from a
       trip no longer appears in its item list, but is still a fact about your
       kit. Record it either way. */
    for (const label of trip.learned.add) {
      const entry = touch(label, "Extras");
      entry.requested = true;
    }
    for (const label of trip.learned.drop) {
      const entry = touch(label, "Extras");
      entry.dropped = true;
    }
  }

  /* Things you listed yourself. These may never have been on a trip, so they
     join the picture rather than being derived from it. */
  for (const own of kit) {
    const entry = touch(own.label, own.category);
    entry.owned = true;
    entry.alwaysNeeded = own.alwaysNeeded ?? false;
    entry.whenTags = own.whenTags ?? [];
    entry.kitId = own.id;
    // A category you chose beats one inferred from a trip item.
    entry.category = own.category;
    if (own.qty !== undefined) counted.set(own.label.toLowerCase(), own.qty);
  }

  /* Quantities resolve last, because an inferred count needs every trip read
     first — the floor is the highest you've packed across all of them. */
  for (const [key, entry] of byLabel) {
    Object.assign(entry, resolveQty(counted.get(key), entry.packedMax));
  }

  return [...byLabel.values()].sort(
    (a, b) => b.packedTimes - a.packedTimes || b.onTrips - a.onTrips || a.label.localeCompare(b.label),
  );
}

export type OwnedCount = { qty: number; qtySource: QtySource };

/** Lowercased label → how many you own, for looking up while packing. */
export function ownedCounts(entries: KitEntry[]): Map<string, OwnedCount> {
  return new Map(
    entries.map((e) => [
      e.label.toLowerCase(),
      { qty: e.qty, qtySource: e.qtySource },
    ]),
  );
}

/**
 * How far a list outruns your kit, when that's worth saying at all.
 *
 * The guard on `assumed` is the whole reason this is a function and not a
 * comparison. Every item nobody has counted sits at 1, so without it a six-day
 * trip would announce a shortfall on every single row and the warning would
 * mean nothing. Only a number with something behind it gets to speak.
 */
export function shortfall(
  want: number,
  owned: OwnedCount | undefined,
): number | undefined {
  if (!owned || owned.qtySource === "assumed") return undefined;
  return want > owned.qty ? want - owned.qty : undefined;
}

export type KitSummary = {
  distinctItems: number;
  tripCount: number;
  /** Carried on a finished trip and never ticked — candidates to drop. */
  deadWeight: KitEntry[];
  /** Things you added yourself that are now part of the standard list. */
  earned: KitEntry[];
  /** Things you've told the board to stop suggesting. */
  retired: KitEntry[];
};

export function summarise(entries: KitEntry[], trips: Trip[]): KitSummary {
  return {
    distinctItems: entries.length,
    tripCount: trips.length,
    deadWeight: entries.filter(
      (e) => !e.dropped && e.unpackedOnFinished > 0 && e.packedTimes === 0,
    ),
    earned: entries.filter((e) => (e.yourOwn || e.requested) && !e.dropped),
    retired: entries.filter((e) => e.dropped),
  };
}
