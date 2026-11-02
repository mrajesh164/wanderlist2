/**
 * Somewhere to be, for each day of a trip.
 *
 * Curated by hand, in the same spirit as `photos.ts`: **the running app never
 * geocodes these.** Every coordinate below was resolved once through
 * Open-Meteo's geocoder and checked to land within 25km of the city it claims
 * to be in, which is not a formality — it rejected four of the first eight New
 * York candidates. "Williamsburg" resolves 215km away, "SoHo" 506km, "Chelsea"
 * 94km and "Dumbo" to another continent entirely. Famous neighbourhood names
 * are not unique, and the geocoder has no idea which one you meant.
 *
 * So: if you add a place, geocode the area first and check the distance.
 * Don't type coordinates from memory.
 *
 * `area` is the load-bearing field. It is a real, geocodable neighbourhood, and
 * it is what the bikes panel uses to find stations near the day's plan. `title`
 * is the thing you'd actually do there and is only a label.
 *
 * Keyed by the same slug as `bike_systems`, so a city with live bikes and a
 * city with an itinerary line up by construction. Lisbon has places but no
 * bikeshare, which is the honest state of things and a case the UI has to
 * handle rather than hide.
 */

export type PlaceCategory =
  | "Museum"
  | "Park"
  | "Market"
  | "Landmark"
  | "Neighbourhood";

export type Place = {
  title: string;
  /** A geocodable neighbourhood — the anchor for the day's bike stations. */
  area: string;
  category: PlaceCategory;
  /**
   * Whether the day survives rain. This is the field the generator sorts on:
   * a wet day gets the museum, a dry one gets the park.
   */
  indoor: boolean;
  lat: number;
  lon: number;
  note: string;
};

export const PLACES: Record<string, Place[]> = {
  chi: [
    { title: "The Art Institute", area: "Grant Park", category: "Museum", indoor: true,
      lat: 41.8795, lon: -87.6189,
      note: "Hours indoors, and the lakefront path is right outside when you surface." },
    { title: "Record shops and taquerias", area: "Wicker Park", category: "Neighbourhood", indoor: false,
      lat: 41.9075, lon: -87.6770,
      note: "Walkable in an afternoon. Milwaukee Avenue is the spine." },
    { title: "The boulevard and the bars", area: "Logan Square", category: "Neighbourhood", indoor: false,
      lat: 41.9234, lon: -87.6992,
      note: "A wide green boulevard to wander, and the farmers' market on Sundays." },
    { title: "The zoo and the conservatory", area: "Lincoln Park", category: "Park", indoor: false,
      lat: 41.9217, lon: -87.6478,
      note: "Both free. The conservatory is the warm option when the lake wind bites." },
    { title: "Murals and mercados", area: "Pilsen", category: "Neighbourhood", indoor: false,
      lat: 41.8575, lon: -87.6576,
      note: "16th Street's painted walls, then anywhere on 18th to eat." },
    { title: "Galleries and the river", area: "River North", category: "Landmark", indoor: true,
      lat: 41.8990, lon: -87.6413,
      note: "Dense with galleries, and the riverwalk is a short walk south." },
  ],
  nyc: [
    { title: "Galleries and cast iron", area: "Tribeca", category: "Neighbourhood", indoor: false,
      lat: 40.7154, lon: -74.0093,
      note: "Cobbles and loading docks turned into shopfronts. Short blocks, easy walking." },
    { title: "The Village wander", area: "Greenwich Village", category: "Neighbourhood", indoor: false,
      lat: 40.7284, lon: -74.0029,
      note: "No grid, which is the point. Washington Square is the anchor." },
    { title: "Uptown museums", area: "Harlem", category: "Museum", indoor: true,
      lat: 40.8079, lon: -73.9454,
      note: "The Studio Museum and the Schomburg Center, both indoors." },
    { title: "Prospect Park and the market", area: "Park Slope", category: "Park", indoor: false,
      lat: 40.6767, lon: -73.9786,
      note: "The park is the better half of Brooklyn's two. Grand Army Plaza on Saturdays." },
    { title: "Waterfront and warehouses", area: "Long Island City", category: "Landmark", indoor: false,
      lat: 40.7448, lon: -73.9488,
      note: "The best skyline view in the city is from this side of the river." },
    { title: "Greek food and the museum", area: "Astoria", category: "Neighbourhood", indoor: true,
      lat: 40.7721, lon: -73.9301,
      note: "The Museum of the Moving Image if it rains, Ditmars Boulevard if it doesn't." },
  ],
  lis: [
    { title: "Lanes and the viewpoint", area: "Alfama", category: "Neighbourhood", indoor: false,
      lat: 38.7112, lon: -9.1277,
      note: "Steep, tangled, and best without a plan. Wear the shoes with grip." },
    { title: "The monastery and the tower", area: "Belem", category: "Landmark", indoor: true,
      lat: 38.6987, lon: -9.1929,
      note: "Mostly indoors once you're in, and a tram ride from the centre." },
    { title: "Miradouros and late dinner", area: "Bairro Alto", category: "Neighbourhood", indoor: false,
      lat: 38.7119, lon: -9.1441,
      note: "Quiet by day, the opposite after ten." },
    { title: "The grid and the river", area: "Baixa", category: "Landmark", indoor: false,
      lat: 38.7114, lon: -9.1372,
      note: "Flat, which after Alfama is the whole appeal." },
    { title: "Garden and antique shops", area: "Principe Real", category: "Park", indoor: false,
      lat: 38.7184, lon: -9.1525,
      note: "One enormous cedar, and the market underneath it on Saturdays." },
    { title: "The terrace above the city", area: "Graca", category: "Park", indoor: false,
      lat: 38.7176, lon: -9.1295,
      note: "Best at the end of the day, looking back over everything you walked." },
  ],
};

/** Which destinations have an itinerary at all. */
export function placesFor(citySlug: string | null | undefined): Place[] {
  return (citySlug && PLACES[citySlug]) || [];
}

/**
 * A typed destination to a curated-places slug.
 *
 * Deliberately the same slug space as `bike_systems`, so one lookup serves
 * both: `chi` has places *and* live bikes, `lis` has places and no bikes, and
 * a station query for `lis` simply returns nothing. That is the correct
 * behaviour rather than a special case to code around.
 */
const BY_DESTINATION: Record<string, string> = {
  chicago: "chi",
  "new york": "nyc",
  "new york city": "nyc",
  nyc: "nyc",
  lisbon: "lis",
  lisboa: "lis",
};

export function citySlugFor(destination: string | null | undefined): string | null {
  if (!destination) return null;
  return BY_DESTINATION[destination.trim().toLowerCase()] ?? null;
}
