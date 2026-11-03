import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseForRequest } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { geocode } from "@/lib/open-meteo";

/**
 * Find the bikeshare system for a city nobody has visited before.
 *
 * `bike_systems` started as twelve rows typed by hand, which meant the app's
 * coverage was bounded by my typing rather than by what exists: a trip to
 * Seattle said "no bikeshare system here yet", which isn't true — I just never
 * wrote a Seattle row. The same shape of problem the curated itineraries had.
 *
 * So the catalogue derives itself. MobilityData publishes a registry of every
 * GBFS system in the world — 1,277 of them, 177 in the US — as a CSV with an
 * auto-discovery URL per system. This looks a city up there, follows the
 * discovery document to the two feed URLs, and writes the row. Once.
 *
 * POST /api/find-system  { "city": "Seattle" }
 *
 *   200 → { system }           found, and now in the table
 *   404 → { error: "none" }    no GBFS system for that city
 *   503 → { error: … }         registry or discovery unreachable
 */

const REGISTRY =
  "https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv";

/** Minimal CSV reader — the registry is machine-generated and well-formed. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = splitRow(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Pull the station feeds out of a GBFS discovery document.
 *
 * Two shapes in the wild and both are common: 1.x nests feeds under a language
 * key (`data.en.feeds`), 3.x puts them directly on `data.feeds`. Handling only
 * the first is why an earlier probe of Honolulu and Pittsburgh "failed" — the
 * systems were fine, the reader wasn't.
 */
function feedsFrom(doc: unknown): Record<string, string> {
  const data = (doc as { data?: unknown })?.data;
  if (!data || typeof data !== "object") return {};
  const holder = data as Record<string, unknown>;
  const list =
    (holder.feeds as { name: string; url: string }[] | undefined) ??
    (
      (holder.en ?? Object.values(holder)[0]) as
        | { feeds?: { name: string; url: string }[] }
        | undefined
    )?.feeds;
  return Object.fromEntries((list ?? []).map((f) => [f.name, f.url]));
}

/** Accents off, lowercase: the registry writes "Montréal", a trip may not. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Is this a system with actual docks?
 *
 * Several operators serve the same city and the registry lists them all —
 * Paris has six, Seattle two. Scooter fleets publish `station_status` too,
 * where a "station" is a painted parking square: Bird Seattle reports zero,
 * Dott Paris reports 12,667 of them with no capacity at all. Requiring at
 * least one station that declares a dock capacity is what separates a
 * bikeshare from a scooter fleet, and it is why Seattle correctly comes back
 * as "no system" rather than as Bird.
 */
async function docked(
  statusUrl: string,
  informationUrl: string,
): Promise<boolean> {
  try {
    const res = await fetch(informationUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      data?: { stations?: { capacity?: number }[] };
    };
    const stations = body.data?.stations ?? [];
    return stations.some((s) => (s.capacity ?? 0) > 0);
  } catch {
    return false;
  }
}

function slugFor(city: string, systemId: string): string {
  const base = (systemId || city).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return base.replace(/^-|-$/g, "").slice(0, 32) || "sys";
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "signed-out" }, { status: 401 });
  }

  const { city } = (await request.json().catch(() => ({}))) as { city?: string };
  const wanted = city?.trim();
  if (!wanted) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }

  const supabase = await supabaseForRequest();
  if (!supabase) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  /* Already known? Two tabs opening at once shouldn't both go to GitHub. */
  const { data: known } = await supabase
    .from("bike_systems")
    .select("slug, name, city, lat, lon")
    .ilike("city", wanted)
    .maybeSingle();
  if (known) return NextResponse.json({ system: known, cached: true });

  try {
    const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`registry ${res.status}`);
    const rows = parseCsv(await res.text());

    /* Registry locations read "Los Angeles, CA" or "Montréal, QC": match the
       part before the first comma, accents normalised. Several operators can
       serve one city, so this collects them all and picks the first that
       actually has docks. Capped, because each candidate costs two requests
       and no city needs more than a few tried. */
    const candidates = rows
      .filter(
        (r) => norm((r["Location"] ?? "").split(",")[0] ?? "") === norm(wanted),
      )
      .slice(0, 4);
    if (candidates.length === 0) {
      return NextResponse.json({ error: "none" }, { status: 404 });
    }

    let hit: Record<string, string> | null = null;
    let statusUrl = "";
    let informationUrl = "";

    for (const candidate of candidates) {
      const discoveryUrl = candidate["Auto-Discovery URL"];
      if (!discoveryUrl) continue;
      try {
        const disc = await fetch(discoveryUrl, {
          signal: AbortSignal.timeout(15_000),
        });
        if (!disc.ok) continue;
        const feeds = feedsFrom(await disc.json());
        const ss = feeds["station_status"];
        const si = feeds["station_information"];
        if (!ss || !si) continue;
        if (!(await docked(ss, si))) continue;
        hit = candidate;
        statusUrl = ss;
        informationUrl = si;
        break;
      } catch {
        /* A feed that refuses us is not a reason to give up on the city —
           Vélib' and Lime both answer 403, and the next candidate may not. */
        continue;
      }
    }

    if (!hit) return NextResponse.json({ error: "none" }, { status: 404 });

    const place = await geocode(wanted);

    /* Written with the service role: bike_systems refuses client writes by
       policy, and this row is shared reference data owned by nobody — the
       same justification as the climate cache. */
    const admin = supabaseAdmin();
    if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

    const row = {
      slug: slugFor(wanted, hit["System ID"] ?? ""),
      name: hit["Name"] || "Bikeshare",
      city: wanted,
      status_url: statusUrl,
      information_url: informationUrl,
      lat: place?.lat ?? null,
      lon: place?.lon ?? null,
    };
    const { error } = await admin
      .from("bike_systems")
      .upsert(row, { onConflict: "slug", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    return NextResponse.json({ system: row });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
