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
  /** A specific place, not a vibe. "The Art Institute", not "a museum". */
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
  /** One line on what it actually is. */
  note: string;
  /** The thing you'd only know having been. Shown, because it is the part
   *  worth reading — the Paris itinerary this borrows from carried one per
   *  stop and it is what made it feel written rather than generated. */
  tip: string;
};

export const PLACES: Record<string, Place[]> = {
  chi: [
    { title: "The Art Institute", area: "Grant Park", category: "Museum", indoor: true,
      lat: 41.8795, lon: -87.6189,
      note: "The second-largest art museum in the country, on Michigan Avenue.",
      tip: "Start on the second floor and work down — everyone else starts at the bottom." },
    { title: "Milwaukee Avenue", area: "Wicker Park", category: "Neighbourhood", indoor: false,
      lat: 41.9075, lon: -87.6770,
      note: "Record shops, secondhand clothes and taquerias along one diagonal street.",
      tip: "The six-corners junction at Damen is the centre; walk north-west from there." },
    { title: "The Logan Square boulevard", area: "Logan Square", category: "Neighbourhood", indoor: false,
      lat: 41.9234, lon: -87.6992,
      note: "A wide planted boulevard with the farmers' market at the centre on Sundays.",
      tip: "The market runs mornings only. Afterwards the bars on Milwaukee open early." },
    { title: "Lincoln Park Zoo", area: "Lincoln Park", category: "Park", indoor: false,
      lat: 41.9217, lon: -87.6478,
      note: "Free, open every day, with the conservatory glasshouse beside it.",
      tip: "The conservatory is the warm room when the lake wind turns — and it's also free." },
    { title: "The 16th Street murals", area: "Pilsen", category: "Landmark", indoor: false,
      lat: 41.8575, lon: -87.6576,
      note: "A mile of painted railway embankment through the old Czech-then-Mexican quarter.",
      tip: "Walk the murals west, then eat anywhere on 18th Street. Cash is still quicker." },
    { title: "The River North galleries", area: "River North", category: "Museum", indoor: true,
      lat: 41.8990, lon: -87.6413,
      note: "Three square blocks holding most of the city's commercial galleries.",
      tip: "Most close by six and all day Sunday. The riverwalk is two minutes south." },
  ],
  nyc: [
    { title: "Cast-iron Tribeca", area: "Tribeca", category: "Neighbourhood", indoor: false,
      lat: 40.7154, lon: -74.0093,
      note: "Cobbled streets and nineteenth-century warehouse fronts south of Canal.",
      tip: "Short blocks and quiet on weekends — the one part of downtown you can hear yourself in." },
    { title: "Washington Square Park", area: "Greenwich Village", category: "Park", indoor: false,
      lat: 40.7284, lon: -74.0029,
      note: "The Village's living room, with the arch at the foot of Fifth Avenue.",
      tip: "The streets west of the park ignore the grid entirely. Getting lost is the activity." },
    { title: "The Studio Museum", area: "Harlem", category: "Museum", indoor: true,
      lat: 40.8079, lon: -73.9454,
      note: "A century of work by artists of African descent, on 125th Street.",
      tip: "The Schomburg Center is ten minutes north if the weather keeps you inside." },
    { title: "Prospect Park", area: "Park Slope", category: "Park", indoor: false,
      lat: 40.6767, lon: -73.9786,
      note: "Olmsted and Vaux's other park, and the one they preferred.",
      tip: "Enter at Grand Army Plaza on a Saturday and the greenmarket is right there." },
    { title: "Gantry Plaza", area: "Long Island City", category: "Landmark", indoor: false,
      lat: 40.7448, lon: -73.9488,
      note: "Old rail gantries on the Queens waterfront, facing midtown across the river.",
      tip: "The best skyline view in the city is from the side of the river nobody photographs." },
    { title: "Museum of the Moving Image", area: "Astoria", category: "Museum", indoor: true,
      lat: 40.7721, lon: -73.9301,
      note: "Film and television history in the old Astoria studio complex.",
      tip: "Ditmars Boulevard afterwards for Greek food — the bakeries stay open late." },
  ],
  lis: [
    { title: "The Alfama lanes", area: "Alfama", category: "Neighbourhood", indoor: false,
      lat: 38.7112, lon: -9.1277,
      note: "The one quarter that survived the 1755 earthquake, and it shows.",
      tip: "Steep, tangled and unmarked. Wear the shoes with grip and don't plan a route." },
    { title: "Jeronimos Monastery", area: "Belem", category: "Landmark", indoor: true,
      lat: 38.6987, lon: -9.1929,
      note: "Manueline cloisters by the river, with the Tower a short walk west.",
      tip: "Mostly indoors once you're through the door — the wet-day option out here." },
    { title: "The Bairro Alto miradouros", area: "Bairro Alto", category: "Landmark", indoor: false,
      lat: 38.7119, lon: -9.1441,
      note: "Terraces looking over the whole lower city, one per hilltop.",
      tip: "Quiet by day and the opposite after ten. Go for the view first, come back later." },
    { title: "Praca do Comercio", area: "Baixa", category: "Landmark", indoor: false,
      lat: 38.7114, lon: -9.1372,
      note: "The grid rebuilt after the earthquake, opening onto the Tagus.",
      tip: "Flat, which after a day in Alfama is the entire appeal." },
    { title: "Principe Real garden", area: "Principe Real", category: "Park", indoor: false,
      lat: 38.7184, lon: -9.1525,
      note: "One enormous spreading cedar, with antique shops on the streets around it.",
      tip: "The market sets up underneath the cedar on Saturday mornings." },
    { title: "Miradouro da Senhora do Monte", area: "Graca", category: "Park", indoor: false,
      lat: 38.7176, lon: -9.1295,
      note: "The highest of the viewpoints, above the Graca terraces.",
      tip: "Best at the end of the day, looking back over everywhere you walked." },
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
