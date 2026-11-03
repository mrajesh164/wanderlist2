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
  sf: [
    { title: "Mission murals and taquerias", area: "Mission District", category: "Neighbourhood", indoor: false,
      lat: 37.7599, lon: -122.4191,
      note: "Balmy and Clarion alleys are painted end to end; the burritos are the other reason.",
      tip: "The Mission gets the city's only reliable sun. Everywhere else, bring the layer." },
    { title: "Hayes Valley", area: "Hayes Valley", category: "Neighbourhood", indoor: false,
      lat: 37.7758, lon: -122.4246,
      note: "Four flat blocks of small shops where a freeway used to be.",
      tip: "Patricia's Green is the middle of it. Flat, which in this city is worth planning around." },
    { title: "The Dogpatch waterfront", area: "Dogpatch", category: "Landmark", indoor: false,
      lat: 37.7611, lon: -122.3884,
      note: "Old shipyards turned into galleries and breweries, on the eastern shore.",
      tip: "The bay trail runs right through. Wind picks up hard after about four." },
    { title: "Haight Street", area: "Haight-Ashbury", category: "Neighbourhood", indoor: false,
      lat: 37.7699, lon: -122.4469,
      note: "Record shops and secondhand clothes, with Golden Gate Park at the west end.",
      tip: "Walk it downhill, east to west, and finish in the park rather than on the hill." },
    { title: "Potrero Hill", area: "Potrero Hill", category: "Park", indoor: false,
      lat: 37.7566, lon: -122.3991,
      note: "A residential hill with the clearest downtown view that isn't on a tour.",
      tip: "Steep. This is the day to let the bike do the work on the way up." },
  ],
  bos: [
    { title: "The Back Bay brownstones", area: "Back Bay", category: "Neighbourhood", indoor: false,
      lat: 42.3501, lon: -71.0870,
      note: "Victorian blocks on a grid, which in Boston is the unusual part.",
      tip: "Newbury Street runs the length of it. The alleys behind are quieter and prettier." },
    { title: "Beacon Hill", area: "Beacon Hill", category: "Neighbourhood", indoor: false,
      lat: 42.3598, lon: -71.0662,
      note: "Gas lamps and brick, sloping down to the Common.",
      tip: "Acorn Street is the photographed one; the streets either side are the nice ones." },
    { title: "Harvard Square", area: "Cambridge", category: "Neighbourhood", indoor: false,
      lat: 42.3751, lon: -71.1056,
      note: "Bookshops and the university, across the river.",
      tip: "The Harvard Art Museums are free to walk into and the courtyard is glass-roofed." },
    { title: "The Charlestown Navy Yard", area: "Charlestown", category: "Landmark", indoor: false,
      lat: 42.3779, lon: -71.0620,
      note: "USS Constitution and the harbour walk, at the north end of the Freedom Trail.",
      tip: "Exposed and cold in anything but summer. Do it on the clear day." },
    { title: "The Museum of Fine Arts", area: "Fenway", category: "Museum", indoor: true,
      lat: 42.3449, lon: -71.1002,
      note: "One of the largest collections in the country, a short walk from the ballpark.",
      tip: "The wet-day option, and big enough to absorb a whole one." },
    { title: "The South End", area: "South End", category: "Neighbourhood", indoor: false,
      lat: 42.3432, lon: -71.0718,
      note: "The largest Victorian district in the country, and where the city eats.",
      tip: "SoWa on a Sunday for the market; most of the rest of the week it is quiet." },
  ],
  dc: [
    { title: "Capitol Hill and the Mall", area: "Capitol Hill", category: "Landmark", indoor: false,
      lat: 38.8896, lon: -77.0094,
      note: "The monumental core, with Eastern Market a few blocks east.",
      tip: "The Mall is much longer than it photographs. Bikes are the honest way to do it." },
    { title: "Adams Morgan", area: "Adams Morgan", category: "Neighbourhood", indoor: false,
      lat: 38.9215, lon: -77.0422,
      note: "18th Street: Ethiopian food, record shops, and the city's loudest nights.",
      tip: "Daytime is the calm version. Come back after nine for the other one." },
    { title: "The Phillips Collection", area: "Dupont Circle", category: "Museum", indoor: true,
      lat: 38.9084, lon: -77.0441,
      note: "America's first museum of modern art, in a house off the circle.",
      tip: "Small enough for an afternoon, which the Smithsonians are not." },
    { title: "Shaw and the U Street corridor", area: "Shaw", category: "Neighbourhood", indoor: false,
      lat: 38.9121, lon: -77.0214,
      note: "The old Black Broadway, with the Howard Theatre still standing.",
      tip: "Ben's Chili Bowl is the landmark; the newer places around it are the meal." },
    { title: "Anacostia", area: "Anacostia", category: "Neighbourhood", indoor: false,
      lat: 38.8676, lon: -76.9955,
      note: "Frederick Douglass's house on the hill, looking back across the river.",
      tip: "The view from Cedar Hill is the one nobody who stays downtown ever sees." },
    { title: "Logan Circle", area: "Logan Circle", category: "Park", indoor: false,
      lat: 38.9098, lon: -77.0293,
      note: "A circle of Victorians with 14th Street running through it.",
      tip: "Walkable to Shaw and Dupont both, which makes it a good middle day." },
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
  boston: "bos",
  "san francisco": "sf",
  washington: "dc",
  "washington dc": "dc",
  "washington, d.c.": "dc",
  lisbon: "lis",
  lisboa: "lis",
};

export function citySlugFor(destination: string | null | undefined): string | null {
  if (!destination) return null;
  return BY_DESTINATION[destination.trim().toLowerCase()] ?? null;
}
