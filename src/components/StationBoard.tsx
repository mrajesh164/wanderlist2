"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession, useUser } from "@clerk/nextjs";
import { Label } from "./Card";
import { Button } from "./Button";
import { QuietAction } from "./Controls";
import { Field, TextInput } from "./Field";
import { TripSection } from "./TripSection";
import { useSupabase } from "@/lib/supabase";
import {
  COUNTS_EXPLAINER,
  countsLabel,
  distanceLabel,
  freshnessLine,
  freshnessOf,
  metresBetween,
  type BikeSystem,
  type Freshness,
  type Station,
  type WorkerRun,
} from "@/lib/stations";
import type { Trip } from "@/lib/types";

/**
 * Bikes near where you're staying, live.
 *
 * Anchored on `trip.staying` — a neighbourhood, a street, a hotel's address —
 * which is saved on the trip rather than typed into a search box. That is the
 * whole difference: a search box is retyped on every device and every sign-in,
 * and a city centre is nobody's hotel.
 *
 * Tell it once and the docks within walking distance register themselves, the
 * worker starts polling them, and the counts arrive and keep arriving. There is
 * no "follow this station" step, because nobody arrives wanting to follow a
 * station.
 */

const SELECT =
  "system_slug, station_id, name, lat, lon, capacity, bikes_available, ebikes_available, docks_available, last_reported, updated_at";

/** Close enough to walk to from where you're sleeping. */
const NEAR_METRES = 700;
/** How many docks to watch. More than a handful is noise, and writes. */
const WATCH = 4;

export function StationBoard({
  trip,
  onSaveStaying,
}: {
  trip: Trip;
  onSaveStaying: (staying: string, lat?: number, lon?: number) => void;
}) {
  const supabase = useSupabase();
  const { user } = useUser();
  const { session } = useSession();

  const [system, setSystem] = useState<BikeSystem | null>(null);
  const [resolved, setResolved] = useState(false);
  const [near, setNear] = useState<Station[]>([]);
  const [latestRun, setLatestRun] = useState<WorkerRun | null>(null);
  const [lastOkRun, setLastOkRun] = useState<WorkerRun | null>(null);
  const [draft, setDraft] = useState(trip.staying ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);

  /* Re-render on a timer so "updated 14 seconds ago" keeps counting and an
     untouched page slides into stale on its own. */
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  /* Destination -> bikeshare system, the same match used for climate. */
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("bike_systems")
          .select("slug, name, city, lat, lon")
          .ilike("city", trip.destination.trim())
          .maybeSingle();
        if (!cancelled) setSystem(data ?? null);
      } finally {
        if (!cancelled) setResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, trip.destination]);

  const loadRuns = useCallback(async () => {
    if (!supabase) return;
    const { data: latest } = await supabase
      .from("worker_runs")
      .select("started_at, ok, rows_changed, error")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: ok } = await supabase
      .from("worker_runs")
      .select("started_at, ok, rows_changed, error")
      .eq("ok", true)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLatestRun(latest ?? null);
    setLastOkRun(ok ?? null);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRuns();
  }, [loadRuns]);

  /**
   * Find the docks near where they're staying, and register them.
   *
   * One effect because the two halves are one thought: the stations we show
   * are exactly the stations the worker needs to be polling, so working out
   * which they are and asking for them should not be able to disagree.
   */
  useEffect(() => {
    if (!supabase || !system || !user) return;
    const { stayingLat: lat, stayingLon: lon } = trip;
    if (lat === undefined || lon === undefined) return;

    let cancelled = false;
    (async () => {
      const pad = 0.012; // ~1.3km box, trimmed by real distance below
      const { data } = await supabase
        .from("stations")
        .select(SELECT)
        .eq("system_slug", system.slug)
        .gte("lat", lat - pad)
        .lte("lat", lat + pad)
        .gte("lon", lon - pad)
        .lte("lon", lon + pad)
        .limit(120);
      if (cancelled) return;

      const closest = (data ?? [])
        .filter((s) => s.lat !== null && s.lon !== null)
        .map((s) => ({ s, m: metresBetween({ lat, lon }, { lat: s.lat!, lon: s.lon! }) }))
        .filter((x) => x.m <= NEAR_METRES)
        .sort((a, b) => a.m - b.m)
        .slice(0, WATCH)
        .map((x) => x.s);

      setNear(closest);
      if (closest.length === 0) return;

      /* ignoreDuplicates so a reload is a no-op rather than a conflict, and
         anything already followed stays followed. */
      await supabase.from("station_follows").upsert(
        closest.map((s) => ({
          user_id: user.id,
          system_slug: system.slug,
          station_id: s.station_id,
        })),
        { onConflict: "user_id,system_slug,station_id", ignoreDuplicates: true },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, system, user, trip.stayingLat, trip.stayingLon, trip]);

  /* Realtime. Needs the Clerk token on the socket, set before subscribing and
     refreshed, or Postgres Changes delivers nothing and says nothing. */
  useEffect(() => {
    if (!supabase || !system || !session) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let refresh: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      const token = await session.getToken();
      if (cancelled) return;
      if (token) supabase.realtime.setAuth(token);

      channel = supabase
        .channel(`bikes-${system.slug}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "stations",
            filter: `system_slug=eq.${system.slug}`,
          },
          (payload) => {
            const row = payload.new as Station;
            setNear((prev) =>
              prev.map((s) =>
                s.station_id === row.station_id ? { ...s, ...row } : s,
              ),
            );
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "worker_runs" },
          () => void loadRuns(),
        )
        .subscribe();

      refresh = setInterval(async () => {
        const next = await session.getToken();
        if (next) supabase.realtime.setAuth(next);
      }, 45_000);
    })();

    return () => {
      cancelled = true;
      if (refresh) clearInterval(refresh);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, system, session, loadRuns]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      setError("Enter a neighbourhood, a street, or an address.");
      return;
    }
    if (!system) return;

    setSaving(true);
    setError(undefined);
    try {
      /* Geocoded on the server, with the system's centre as the tiebreaker —
         place names are not unique and "Mission District" exists in several
         countries. */
      const res = await fetch(
        `/api/place?q=${encodeURIComponent(text)}&lat=${system.lat ?? 0}&lon=${system.lon ?? 0}`,
      );
      if (!res.ok) {
        setError(
          res.status === 404
            ? "Couldn't find that. Try a neighbourhood or a nearby street."
            : "Couldn't look that up just now. Try again in a moment.",
        );
        return;
      }
      const { places } = (await res.json()) as {
        places: { lat: number; lon: number; label: string }[];
      };
      const hit = places[0];
      if (!hit) {
        setError("Couldn't find that. Try a neighbourhood or a nearby street.");
        return;
      }
      onSaveStaying(text, hit.lat, hit.lon);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!supabase) return null;

  if (!resolved) {
    return (
      <TripSection title="Live bikes">
        <p className="text-small text-muted">Checking for bikes…</p>
      </TripSection>
    );
  }

  if (!system) {
    return (
      <TripSection title="Live bikes" meta={trip.destination}>
        <p className="measure text-small text-muted">
          No bikeshare system in {trip.destination} yet. Chicago, New York,
          Boston, Washington and San Francisco are covered.
        </p>
      </TripSection>
    );
  }

  const state: Freshness = freshnessOf(latestRun, lastOkRun);
  const anchored = trip.stayingLat !== undefined && trip.stayingLon !== undefined;
  const showForm = editing || !trip.staying;

  return (
    <TripSection
      title={`Live bikes in ${system.city}`}
      meta={`${system.name} · updating itself`}
      note={anchored ? COUNTS_EXPLAINER : undefined}
    >
      {showForm ? (
        <form onSubmit={save} noValidate className="max-w-md">
          <Field
            label="Where are you staying?"
            hint="A neighbourhood, a street, or an address. Saved with the trip, so you only say it once."
            error={error}
          >
            {(props) => (
              <TextInput
                {...props}
                value={draft}
                placeholder="Wicker Park"
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (error) setError(undefined);
                }}
              />
            )}
          </Field>
          <span className="flex items-center gap-3">
            <Button type="submit">{saving ? "Finding…" : "Save"}</Button>
            {trip.staying && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDraft(trip.staying ?? "");
                  setEditing(false);
                  setError(undefined);
                }}
              >
                Cancel
              </Button>
            )}
          </span>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-body text-ink">
              Near <span className="font-semibold">{trip.staying}</span>
            </span>
            <QuietAction
              onClick={() => setEditing(true)}
              label="Change where you're staying"
              className="opacity-100 underline decoration-rule-strong underline-offset-2 hover:text-ink"
            >
              Change
            </QuietAction>
          </div>

          <FreshnessLine state={state} line={freshnessLine(state, lastOkRun)} />

          {near.length > 0 ? (
            <ul className="mt-3 border border-rule-strong bg-surface shadow-raised">
              {near.map((s) => (
                <li
                  key={s.station_id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-3 py-2 last:border-b-0"
                >
                  <span className="text-ink">{s.name ?? s.station_id}</span>
                  <span className="flex items-baseline gap-3">
                    {s.lat !== null && s.lon !== null && (
                      <Label>
                        {distanceLabel(
                          metresBetween(
                            { lat: trip.stayingLat!, lon: trip.stayingLon! },
                            { lat: s.lat, lon: s.lon },
                          ),
                        )}
                      </Label>
                    )}
                    <span
                      className={
                        s.bikes_available === null
                          ? "text-small italic text-muted"
                          : state === "fresh"
                            ? "font-semibold text-ink"
                            : "text-muted"
                      }
                    >
                      {s.bikes_available === null ? "counting…" : countsLabel(s)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="measure mt-3 text-small text-muted">
              No docks within a few minutes&rsquo; walk of there. Try a nearby
              street or a wider landmark.
            </p>
          )}
        </>
      )}
    </TripSection>
  );
}

/** A problem is a rule, an icon and a tint — never an accent-coloured control. */
function FreshnessLine({ state, line }: { state: Freshness; line: string }) {
  if (state === "stale") {
    return (
      <p className="mt-2 border-l-[3px] border-warning bg-warning/10 px-3 py-1.5 text-small text-warning">
        {line}
      </p>
    );
  }
  if (state === "down") {
    return (
      <p className="mt-2 border-l-[3px] border-error bg-error/10 px-3 py-1.5 text-small text-error">
        {line}
      </p>
    );
  }
  return <p className="mt-2 text-small text-muted">{line}</p>;
}
