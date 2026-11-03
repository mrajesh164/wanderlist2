import type { TempBand, Wetness } from "./climate";

/**
 * Dates are stored as "YYYY-MM-DD" strings rather than Date objects, so what
 * lands in localStorage stays readable and doesn't shift by a day depending on
 * the reader's timezone.
 */
export type DateString = string;

/**
 * Categories are open-ended on purpose: the seven below cover most packing, but
 * someone who needs "Climbing gear" or "Baby" shouldn't have to file it under
 * Extras. Anything new gets a colour derived from its name — see
 * components/categoryStyle.ts.
 */
export type ItemCategory = string;

export const KNOWN_CATEGORIES = [
  "Documents",
  "Outerwear",
  "Clothing",
  "Footwear",
  "Toiletries",
  "Tech",
  "Extras",
] as const;

export type KnownCategory = (typeof KNOWN_CATEGORIES)[number];

/** The default sections, in the order they should appear. */
export const CATEGORY_ORDER: ItemCategory[] = [...KNOWN_CATEGORIES];

/**
 * Known sections first, then any the person invented, so a custom category
 * never shuffles the familiar ones around.
 */
export function categoriesPresent(categories: string[]): ItemCategory[] {
  const extras = [...new Set(categories)]
    .filter((c) => !KNOWN_CATEGORIES.includes(c as KnownCategory))
    .sort((a, b) => a.localeCompare(b));
  return [...CATEGORY_ORDER, ...extras];
}

/** Why an item is on the list — shown to explain the tool's reasoning. */
export type ItemSource =
  | "essential" /* every trip needs it */
  | "climate" /* because of the weather there that month */
  | "duration" /* quantity came from the trip length */
  | "learned" /* you asked for it after a previous trip */
  | "manual"; /* you typed it */

export type Item = {
  id: string;
  label: string;
  qty: number;
  category: ItemCategory;
  source: ItemSource;
  packed: boolean;
};

export type TripReview = {
  /** Item labels you marked as never used — dropped next time. */
  neverUsed: string[];
  /** Things you wished you'd brought — added next time. */
  wishedFor: string[];
  reviewedAt: string;
};

/** Somewhere on a trip worth knowing the bike counts near. */
export type StayingPlace = {
  /** Exactly what the person typed — shown back to them, not a geocoder label. */
  label: string;
  /** Resolved once, server-side, and cached so it isn't looked up every load. */
  lat: number;
  lon: number;
};

export type Trip = {
  id: string;
  /** What you call this trip: "Thanksgiving at my parents'". */
  name: string;
  /** Free text, shown on the board. */
  destination: string;
  /** Slug into the climate table, when the destination matched one. */
  climateSlug?: string;
  /** Set only when the destination isn't in the climate table. */
  manualBand?: TempBand;
  manualWetness?: Wetness;
  /**
   * Places on this trip you want live bike counts for — where you're staying,
   * and any neighbourhood you're weighing up.
   *
   * Saved on the trip rather than typed into a search box, so it survives
   * signing out and follows you to another device. A list rather than one
   * field because choosing between neighbourhoods is half of what the counts
   * are for.
   */
  stayingPlaces: StayingPlace[];
  startDate: DateString;
  endDate: DateString;
  items: Item[];
  createdAt: string;
  /** Set when you mark the trip finished; moves it off the upcoming board. */
  completedAt?: string;
  review?: TripReview;
  /**
   * Corrections carried forward from every past run of this trip. This is the
   * "it remembers" part: pack it again and the list starts already fixed.
   */
  learned: {
    drop: string[];
    add: string[];
  };
};

/**
 * Something you own, added to your inventory directly rather than inferred from
 * a trip. Trips still generate most of the picture; this is for the things you
 * know you have but haven't packed yet.
 */
/**
 * When something is needed. Closed vocabulary, and deliberately so: every tag
 * has to be something the app can decide about a trip on its own.
 *
 *   cold / hot / wet   from the climate normals the list is already built from
 *   weekend / long     from the dates
 *
 * A free-text tag would let someone write "beach" and then wonder why it never
 * fired, because nothing can evaluate it.
 */
export type WhenTag = "cold" | "hot" | "wet" | "weekend" | "long";

export const WHEN_TAGS: { tag: WhenTag; label: string }[] = [
  { tag: "cold", label: "When it's cold" },
  { tag: "hot", label: "When it's hot" },
  { tag: "wet", label: "When it rains" },
  { tag: "weekend", label: "Weekends" },
  { tag: "long", label: "Long trips" },
];

export type KitItem = {
  id: string;
  label: string;
  category: ItemCategory;
  /**
   * How many you own — set only when you've actually said so.
   *
   * Undefined is meaningful and is the common case: an item added by pasting a
   * list, or added automatically because you packed it, tells us you own the
   * thing but nothing about how many. The inventory fills that gap by inferring
   * from what you've packed rather than inventing a number here. See
   * `resolveQty` in lib/inventory.ts.
   */
  qty?: number;
  /** On every trip, regardless of weather or length. */
  alwaysNeeded?: boolean;
  /** The conditions that call for it. Empty means "no opinion". */
  whenTags?: WhenTag[];
  addedAt: string;
};

export type StoredState = {
  version: 1;
  trips: Trip[];
  kit: KitItem[];
};

export const EMPTY_STATE: StoredState = { version: 1, trips: [], kit: [] };
