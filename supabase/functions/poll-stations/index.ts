/**
 * poll-stations — the worker.
 *
 * Not a server. A single file Supabase runs on its own machines when something
 * invokes it; Supabase Cron is what invokes it, every 30 seconds. It wakes,
 * runs for a second or two, writes a row saying what it did, and dies.
 *
 * It writes with the service role key, which Supabase injects as an
 * environment variable on its own servers and which therefore never appears in
 * this repository. That key bypasses RLS, which is why the worker can write
 * `stations` even though every policy on that table refuses client writes.
 *
 * Two modes:
 *
 *   POST {}                 the cron path. Polls every system somebody follows
 *                           and updates only the followed stations that moved.
 *   POST {"seed":"chi"}     one-time. Loads a system's full station list — the
 *                           names and coordinates the picker needs — without
 *                           touching any counts.
 *
 * The seed mode exists to break a bootstrap deadlock: the worker only polls
 * systems somebody follows, but nobody can follow a station until there is a
 * list to pick from.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  changedRows,
  parseInformation,
  parseStatus,
  type StationCounts,
} from "../_shared/gbfs.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/* Postgres has a parameter ceiling and a followed set is unbounded in
   principle, so reads and writes go in slices. In practice a run handles a
   handful of stations and this never triggers. */
const CHUNK = 400;

function chunked<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function fetchJSON(url: string): Promise<unknown> {
  /* A hung feed must not hold the whole run open — the next cron tick is 30
     seconds away and a stuck invocation would overlap it. */
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return await res.json();
}

/** One-time: fill in the names and coordinates for every station in a system. */
async function seedSystem(slug: string): Promise<number> {
  const { data: system, error } = await supabase
    .from("bike_systems")
    .select("slug, information_url")
    .eq("slug", slug)
    .single();
  if (error) throw new Error(`unknown system ${slug}: ${error.message}`);

  const facts = parseInformation(
    await fetchJSON(system.information_url) as never,
    slug,
  );

  /* Counts are deliberately absent from these rows. An upsert only writes the
     columns it is given, so seeding a system that is already live leaves its
     live numbers untouched. */
  for (const slice of chunked(facts)) {
    const { error: wrote } = await supabase
      .from("stations")
      .upsert(slice, { onConflict: "system_slug,station_id" });
    if (wrote) throw new Error(`seeding ${slug}: ${wrote.message}`);
  }
  return facts.length;
}

/** The cron path: refresh the followed stations of one system. */
async function pollSystem(slug: string, followed: string[]): Promise<number> {
  const { data: system, error } = await supabase
    .from("bike_systems")
    .select("slug, status_url")
    .eq("slug", slug)
    .single();
  if (error) throw new Error(`unknown system ${slug}: ${error.message}`);

  const incoming = parseStatus(await fetchJSON(system.status_url) as never, slug);

  const stored = new Map<string, StationCounts>();
  for (const slice of chunked(followed)) {
    const { data, error: read } = await supabase
      .from("stations")
      .select("station_id, bikes_available, ebikes_available, docks_available, last_reported")
      .eq("system_slug", slug)
      .in("station_id", slice);
    if (read) throw new Error(`reading ${slug}: ${read.message}`);
    for (const r of data ?? []) stored.set(r.station_id, r);
  }

  const changed = changedRows(incoming, stored, followed);
  if (changed.length === 0) return 0;

  const now = new Date().toISOString();
  const rows = changed.map((r) => ({ ...r, updated_at: now }));

  for (const slice of chunked(rows)) {
    const { error: wrote } = await supabase
      .from("stations")
      .upsert(slice, { onConflict: "system_slug,station_id" });
    if (wrote) throw new Error(`writing ${slug}: ${wrote.message}`);
  }
  return changed.length;
}

Deno.serve(async (req) => {
  const startedAt = new Date().toISOString();
  let systemsPolled = 0;
  let rowsChanged = 0;

  try {
    const body = await req.json().catch(() => ({})) as { seed?: string };

    if (body.seed) {
      const loaded = await seedSystem(body.seed);
      return Response.json({ seeded: body.seed, stations: loaded });
    }

    /* Follows are the only thing that decides what gets polled. Nobody
       watching a city means no fetch, which is the cheapest run there is. */
    const { data: follows, error } = await supabase
      .from("station_follows")
      .select("system_slug, station_id");
    if (error) throw new Error(`reading follows: ${error.message}`);

    const bySystem = new Map<string, string[]>();
    for (const f of follows ?? []) {
      const list = bySystem.get(f.system_slug) ?? [];
      list.push(f.station_id);
      bySystem.set(f.system_slug, list);
    }

    for (const [slug, ids] of bySystem) {
      rowsChanged += await pollSystem(slug, [...new Set(ids)]);
      systemsPolled++;
    }

    await supabase.from("worker_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: true,
      systems_polled: systemsPolled,
      rows_changed: rowsChanged,
    });

    return Response.json({ ok: true, systemsPolled, rowsChanged });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    /* A failed run is recorded, not swallowed. The page reads this table to
       tell "stale" from "down", and without a row it would show ageing
       numbers as though the pipe were merely slow. */
    await supabase.from("worker_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: false,
      systems_polled: systemsPolled,
      rows_changed: rowsChanged,
      error: message,
    });

    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
