import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseForRequest } from "@/lib/supabase-server";

/**
 * The cities a trip can be made to.
 *
 * A destination has to work in both halves of the app — a live bikeshare feed
 * with bikes in it, and weather for the right place — so the field can only
 * offer cities where both are known to hold. That list is the verified half of
 * `bike_systems`: rows carrying a `verified_at`, stamped by
 * `scripts/verify-systems.mjs` after probing each feed end to end.
 *
 * GET /api/cities?q=chi  → the eight best matches, for typing
 * GET /api/cities?all=1  → every city, for the browse list
 *
 * **This used to read MobilityData's registry CSV directly, and it was wrong
 * to.** The registry lists 1,277 systems; 938 distinct city names. Most of
 * those cities cannot be served: the feed is free-floating, or dead, or the
 * "Location" column holds "Mecklenburg-Vorpommern" rather than a city. Offering
 * them is how a trip to Pittsburgh ended up on a page reading "No docked
 * bikeshare in Pittsburgh" — which was itself a lie, since Pogoh is real and
 * the worker simply could not read its GBFS 3.0 field names. The registry is
 * still where the list comes from; it is just probed first now, by the script,
 * rather than trusted per keystroke.
 */

export type CityOption = { city: string; region: string; country: string };

/** Accents off, lowercase — the registry writes "Montréal", people type "Montreal". */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "signed-out" }, { status: 401 });
  }

  const supabase = await supabaseForRequest();
  if (!supabase) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const q = norm(params.get("q") ?? "");

  /* 250 rows of three short strings is a few tens of kilobytes. Filtering in
     JS rather than in SQL keeps accent folding in one place — Postgres would
     need unaccent installed to agree with the input the browser sends. */
  const { data, error } = await supabase
    .from("bike_systems")
    .select("city, region, country")
    .not("verified_at", "is", null)
    .order("city");

  if (error) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const all: CityOption[] = (data ?? []).map((r) => ({
    city: r.city,
    region: r.region ?? "",
    country: r.country ?? "",
  }));

  if (params.get("all")) return NextResponse.json({ cities: all });
  if (!q) return NextResponse.json({ cities: all.slice(0, 8) });

  /* Prefix matches first — someone typing "chi" means Chicago, not Cochin. */
  const starts = all.filter((c) => norm(c.city).startsWith(q));
  const contains = all.filter(
    (c) => !norm(c.city).startsWith(q) && norm(c.city).includes(q),
  );
  return NextResponse.json({ cities: [...starts, ...contains].slice(0, 8) });
}
