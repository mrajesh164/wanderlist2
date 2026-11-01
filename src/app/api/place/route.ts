import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ClimateUnavailable, geocodeNear } from "@/lib/open-meteo";

/**
 * Turn a neighbourhood into coordinates, on the server.
 *
 * Same answer as `/api/climate` to "where do you call the API, and why
 * there": on the server, because the browser must never hold a third-party
 * endpoint. It is the same provider as the climate lookup — Open-Meteo's
 * geocoder — so this does not make a second external API load-bearing. The
 * *live* source is still GBFS, and still fetched only by the worker.
 *
 * Why this route exists at all: the station picker used to ask for a station
 * name, which assumes you already know Divvy's naming. Nobody visiting a city
 * knows that. Asking where you're staying is the question a person can
 * actually answer.
 *
 * GET /api/place?q=Wicker+Park&lat=41.88&lon=-87.63
 *
 *   200 → { places: [{ lat, lon, label }] }   nearest the hint first
 *   404 → { error: "not-found" }              nothing matched
 *   503 → { error: "unavailable" }            couldn't reach the geocoder
 *
 * Not cached, and that is a considered difference from `/api/climate` rather
 * than an oversight. Climate needed a cache table because one lookup is
 * fifteen sequential archive requests and the free tier 429s after about ten.
 * This is a single request, fired only when somebody deliberately types a
 * place, and debounced before it leaves the browser. If it ever starts
 * costing, a `place_cache` keyed on the query is the fix.
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "signed-out" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));

  if (q.length < 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { error: "bad-request", detail: "q (2+ chars), lat and lon are required" },
      { status: 400 },
    );
  }

  try {
    const places = await geocodeNear(q, { lat, lon });
    if (places.length === 0) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    return NextResponse.json({ places });
  } catch (e) {
    /* Distinguish "we can't reach the geocoder" from "that place isn't real".
       They are different screens, which is the same rule /api/climate follows. */
    if (e instanceof ClimateUnavailable) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
