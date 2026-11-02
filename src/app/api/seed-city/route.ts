import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseForRequest } from "@/lib/supabase-server";

/**
 * Load a city's station list the first time somebody needs it.
 *
 * A system has no stations until the worker's seed path runs, and the worker
 * only polls systems somebody already follows — so a brand-new trip to a city
 * nobody has visited finds a bikeshare system, finds no stations, and shows an
 * empty section. That happened: Chicago was seeded by hand during development
 * and New York wasn't, so the first New York trip looked broken.
 *
 * POST /api/seed-city  { "slug": "nyc" }
 *
 * **Why this is a route handler and not a call from the browser.** The obvious
 * version is `supabase.functions.invoke` from the page, and it does not work.
 * The Functions gateway only accepts a JWT signed by the project; this app's
 * browser client carries a *Clerk* token, so the invoke returns 401 and the
 * seed silently never happens. Checked rather than assumed — anon key 200, no
 * token 401, malformed token 401.
 *
 * So the call is made here, server-side, with the project's publishable key,
 * behind Clerk's own check. The browser never holds a function credential.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "signed-out" }, { status: 401 });
  }

  const { slug } = (await request.json().catch(() => ({}))) as {
    slug?: string;
  };
  if (!slug) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  /* The slug has to be one we already know about. Without this the endpoint
     would take any string and hand it to the worker, which looks it up and
     fetches whatever URL it finds — a short hop from "seed a city" to "make
     the server fetch something for me". */
  const supabase = await supabaseForRequest();
  if (!supabase) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  const { data: system } = await supabase
    .from("bike_systems")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!system) {
    return NextResponse.json({ error: "unknown-system" }, { status: 404 });
  }

  /* Already loaded? Say so rather than re-fetching 2,500 rows because two
     tabs opened at once. */
  const { count } = await supabase
    .from("stations")
    .select("station_id", { count: "exact", head: true })
    .eq("system_slug", slug);
  if ((count ?? 0) > 0) {
    return NextResponse.json({ seeded: slug, stations: count, cached: true });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  try {
    const res = await fetch(`${base}/functions/v1/poll-stations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ seed: slug }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "seed-failed" }, { status: 503 });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "seed-failed" }, { status: 503 });
  }
}
