import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * Cities that have a bikeshare feed, for the destination field to offer.
 *
 * A trip can only be made to somewhere the live layer will actually work, so
 * the destination field has to know which places those are before the trip
 * exists. That list is MobilityData's registry: **945 cities across 47
 * countries**, published as a CSV.
 *
 * GET /api/cities?q=chi → { cities: [{ city, region, country }] }
 *
 * The registry is ~186KB and changes about as often as a bikeshare system
 * opens, so it is held in module scope for an hour rather than re-fetched per
 * keystroke. A cold serverless instance pays for it once.
 */

const REGISTRY =
  "https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv";
const TTL_MS = 60 * 60 * 1000;

export type CityOption = { city: string; region: string; country: string };

let cache: { at: number; cities: CityOption[] } | null = null;

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

/** Accents off, lowercase — the registry writes "Montréal", people type "Montreal". */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

async function cities(): Promise<CityOption[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.cities;

  const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`registry ${res.status}`);
  const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
  const head = splitRow(lines[0]!);
  const iLoc = head.indexOf("Location");
  const iCountry = head.indexOf("Country Code");

  /* One entry per city, not per system: Paris has six operators and the
     person picking a destination does not care which. */
  const seen = new Map<string, CityOption>();
  for (const line of lines.slice(1)) {
    const cells = splitRow(line);
    const location = cells[iLoc] ?? "";
    if (!location) continue;
    const [city, ...rest] = location.split(",").map((p) => p.trim());
    if (!city) continue;
    const key = norm(city);
    if (seen.has(key)) continue;
    seen.set(key, {
      city,
      region: rest.join(", "),
      country: cells[iCountry] ?? "",
    });
  }

  const list = [...seen.values()].sort((a, b) => a.city.localeCompare(b.city));
  cache = { at: Date.now(), cities: list };
  return list;
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "signed-out" }, { status: 401 });
  }

  const q = norm(new URL(request.url).searchParams.get("q") ?? "");

  try {
    const all = await cities();
    if (!q) return NextResponse.json({ cities: all.slice(0, 8) });

    /* Prefix matches first — someone typing "chi" means Chicago, not Cochin. */
    const starts = all.filter((c) => norm(c.city).startsWith(q));
    const contains = all.filter(
      (c) => !norm(c.city).startsWith(q) && norm(c.city).includes(q),
    );
    return NextResponse.json({ cities: [...starts, ...contains].slice(0, 8) });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
