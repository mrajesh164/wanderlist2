import type { SupabaseClient } from "@supabase/supabase-js";
import type { Item, KitItem, Trip, TripReview } from "./types";
import type { TempBand, Wetness } from "./climate";

/**
 * The translation layer between Postgres rows and the shapes the app already
 * thinks in. Nothing above this file knows about snake_case or about Supabase.
 *
 * Ids stay client-generated (`crypto.randomUUID()`), even though both tables
 * default them. That keeps `addTrip(trip)` synchronous from the caller's point
 * of view and lets an optimistic row carry its final id immediately, instead of
 * rendering a placeholder and swapping it when the insert returns.
 */

type TripRow = {
  id: string;
  user_id: string;
  name: string;
  destination: string;
  climate_slug: string | null;
  staying: string | null;
  staying_lat: number | null;
  staying_lon: number | null;
  manual_band: string | null;
  manual_wetness: string | null;
  start_date: string;
  end_date: string;
  items: Item[] | null;
  learned: { drop: string[]; add: string[] } | null;
  review: TripReview | null;
  completed_at: string | null;
  created_at: string;
};

type KitRow = {
  id: string;
  user_id: string;
  label: string;
  category: string;
  qty: number | null;
  added_at: string;
};

function toTrip(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    destination: row.destination,
    climateSlug: row.climate_slug ?? undefined,
    staying: row.staying ?? undefined,
    stayingLat: row.staying_lat ?? undefined,
    stayingLon: row.staying_lon ?? undefined,
    manualBand: (row.manual_band as TempBand | null) ?? undefined,
    manualWetness: (row.manual_wetness as Wetness | null) ?? undefined,
    startDate: row.start_date,
    endDate: row.end_date,
    items: row.items ?? [],
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    review: row.review ?? undefined,
    /* Normalised so callers can rely on it, the same guarantee readState used
       to give. */
    learned: {
      drop: row.learned?.drop ?? [],
      add: row.learned?.add ?? [],
    },
  };
}

/** The columns we write. `created_at` is left to the database. */
function toTripPayload(trip: Trip, userId: string) {
  return {
    id: trip.id,
    user_id: userId,
    name: trip.name,
    destination: trip.destination,
    climate_slug: trip.climateSlug ?? null,
    staying: trip.staying ?? null,
    staying_lat: trip.stayingLat ?? null,
    staying_lon: trip.stayingLon ?? null,
    manual_band: trip.manualBand ?? null,
    manual_wetness: trip.manualWetness ?? null,
    start_date: trip.startDate,
    end_date: trip.endDate,
    items: trip.items,
    learned: trip.learned,
    review: trip.review ?? null,
    completed_at: trip.completedAt ?? null,
  };
}

function toKitItem(row: KitRow): KitItem {
  return {
    id: row.id,
    label: row.label,
    category: row.category,
    /* null means nobody ever said how many — not the same as 1. The inventory
       infers a floor from what's been packed instead. */
    qty: row.qty ?? undefined,
    addedAt: row.added_at,
  };
}

export type Snapshot = { trips: Trip[]; kit: KitItem[] };

/**
 * Everything belonging to the signed-in person, in two queries.
 *
 * No `.eq('user_id', ...)` anywhere in this file: RLS already restricts every
 * row to its owner, and adding the filter here would imply the database wasn't
 * doing it. If these ever return someone else's data, the policies are broken
 * and a client-side filter would only hide that.
 */
export async function fetchSnapshot(
  supabase: SupabaseClient,
): Promise<Snapshot> {
  const [tripsResult, kitResult] = await Promise.all([
    supabase.from("trips").select("*").order("start_date", { ascending: true }),
    supabase.from("kit_items").select("*").order("added_at", { ascending: true }),
  ]);

  if (tripsResult.error) throw new Error(tripsResult.error.message);
  if (kitResult.error) throw new Error(kitResult.error.message);

  return {
    trips: (tripsResult.data as TripRow[]).map(toTrip),
    kit: (kitResult.data as KitRow[]).map(toKitItem),
  };
}

export async function insertTrip(
  supabase: SupabaseClient,
  trip: Trip,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from("trips").insert(toTripPayload(trip, userId));
  if (error) throw new Error(error.message);
}

/**
 * Trips are written whole rather than field by field. The checklist already
 * lives as one jsonb blob and most edits touch both it and `learned`, so
 * sending the row entire avoids a patch-shape for every combination.
 */
export async function saveTrip(
  supabase: SupabaseClient,
  trip: Trip,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("trips")
    .update(toTripPayload(trip, userId))
    .eq("id", trip.id);
  if (error) throw new Error(error.message);
}

export async function deleteTrip(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("trips").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function insertKitItems(
  supabase: SupabaseClient,
  items: KitItem[],
  userId: string,
): Promise<void> {
  if (items.length === 0) return;
  const { error } = await supabase.from("kit_items").insert(
    items.map((item) => ({
      id: item.id,
      user_id: userId,
      label: item.label,
      category: item.category,
      qty: item.qty ?? null,
      added_at: item.addedAt,
    })),
  );
  if (error) throw new Error(error.message);
}

export async function saveKitQty(
  supabase: SupabaseClient,
  id: string,
  qty: number,
): Promise<void> {
  const { error } = await supabase.from("kit_items").update({ qty }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteKitItem(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("kit_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
