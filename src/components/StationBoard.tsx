"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession, useUser } from "@clerk/nextjs";
import { Label } from "./Card";
import { Button } from "./Button";
import { QuietAction, SuggestionList } from "./Controls";
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
import type { StayingPlace, Trip } from "@/lib/types";

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
/** Docks shown per place. More than a few is noise, and more writes. */
const PER_PLACE = 3;

export function StationBoard({
  trip,
  onAddPlace,
  onRemovePlace,
}: {
  trip: Trip;
  onAddPlace: (place: StayingPlace) => void;
  onRemovePlace: (label: string) => void;
}) {
  const supabase = useSupabase();
  const { user } = useUser();
  const { session } = useSession();

  const [system, setSystem] = useState<BikeSystem | null>(null);
  const [resolved, setResolved] = useState(false);
  /** Docks within walking distance of each place, keyed by its label. */
  const [byPlace, setByPlace] = useState<Record<string, Station[]>>({});
  const [latestRun, setLatestRun] = useState<WorkerRun | null>(null);
  const [lastOkRun, setLastOkRun] = useState<WorkerRun | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Geocoder candidates for what's being typed, so you can see it will work. */
  const [candidates, setCandidates] = useState<
    { label: string; lat: number; lon: number; kind?: string }[]
  >([]);
  const [error, setError] = useState<string | undefined>();
  /* Only the setter matters: the value is never read, it exists to force the
     re-render that keeps "updated 14 seconds ago" counting. */
  const [, setTick] = useState(0);

  /* Re-render on a timer so "updated 14 seconds ago" keeps counting and an
     untouched page slides into stale on its own. */
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  /**
   * Destination -> bikeshare system.
   *
   * Known cities answer from the table. One we have never seen goes to
   * /api/find-system, which looks it up in MobilityData's registry of every
   * GBFS system in the world and writes the row — so coverage is bounded by
   * what exists rather than by what I typed into a migration.
   */
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      try {
        const city = trip.destination.trim();
        const { data } = await supabase
          .from("bike_systems")
          .select("slug, name, city, lat, lon")
          .ilike("city", city)
          .maybeSingle();
        if (cancelled) return;
        if (data) {
          setSystem(data);
          return;
        }

        const res = await fetch("/api/find-system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city }),
        });
        if (cancelled) return;
        if (res.ok) {
          const { system: found } = (await res.json()) as {
            system: BikeSystem | null;
          };
          setSystem(found ?? null);
        } else {
          setSystem(null);
        }
      } catch {
        if (!cancelled) setSystem(null);
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
   * Find the docks near every saved place, and register them.
   *
   * One effect because the two halves are one thought: the stations shown are
   * exactly the stations the worker needs to poll, so working out which they
   * are and asking for them must not be able to disagree.
   */
  const placesKey = trip.stayingPlaces
    .map((p) => `${p.label}@${p.lat},${p.lon}`)
    .join("|");

  useEffect(() => {
    if (!supabase || !system || !user) return;
    const places = trip.stayingPlaces;
    if (places.length === 0) {
      return;
    }

    let cancelled = false;
    (async () => {
      const pad = 0.012; // ~1.3km box per place, trimmed by real distance below
      const found: Record<string, Station[]> = {};
      const wanted = new Set<string>();

      for (const place of places) {
        const { data } = await supabase
          .from("stations")
          .select(SELECT)
          .eq("system_slug", system.slug)
          .gte("lat", place.lat - pad)
          .lte("lat", place.lat + pad)
          .gte("lon", place.lon - pad)
          .lte("lon", place.lon + pad)
          .limit(120);
        if (cancelled) return;

        const closest = (data ?? [])
          .filter((s) => s.lat !== null && s.lon !== null)
          .map((s) => ({
            s,
            m: metresBetween(place, { lat: s.lat!, lon: s.lon! }),
          }))
          .filter((x) => x.m <= NEAR_METRES)
          .sort((a, b) => a.m - b.m)
          .slice(0, PER_PLACE);

        found[place.label] = closest.map((x) => x.s);
        for (const x of closest) wanted.add(x.s.station_id);
      }

      if (cancelled) return;
      setByPlace(found);
      if (wanted.size === 0) return;

      /* ignoreDuplicates so a reload is a no-op, and two places sharing a dock
         register it once. */
      await supabase.from("station_follows").upsert(
        [...wanted].map((station_id) => ({
          user_id: user.id,
          system_slug: system.slug,
          station_id,
        })),
        { onConflict: "user_id,system_slug,station_id", ignoreDuplicates: true },
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placesKey is the list
  }, [supabase, system, user, placesKey]);

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
            setByPlace((prev) => {
              const next: Record<string, Station[]> = {};
              for (const [label, list] of Object.entries(prev)) {
                next[label] = list.map((s) =>
                  s.station_id === row.station_id ? { ...s, ...row } : s,
                );
              }
              return next;
            });
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

  /**
   * Suggest as they type, from two places at once.
   *
   * The geocoder alone is not a type-ahead: Open-Meteo matches whole names,
   * not prefixes. Measured — "Wick", "Wicke" and "Wicker" all return ten
   * results and *none* of them within 60km of Chicago, while "Wicker Park"
   * returns three and all three are right. So a dropdown fed only by the
   * geocoder stays empty until the name is complete, which is exactly when
   * you no longer need it.
   *
   * The station table does prefix-match, locally, and station names are
   * themselves places — "Damen Ave & Wicker Park Ave" is a perfectly good
   * answer to "where are you staying". So both are offered: the docks whose
   * names contain what you typed, and the neighbourhood once it resolves.
   */
  useEffect(() => {
    const q = draft.trim();
    if (!supabase || !system || q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCandidates([]);
      return;
    }
    let cancelled = false;

    const t = setTimeout(async () => {
      const centre = { lat: system.lat ?? 0, lon: system.lon ?? 0 };
      const out: { label: string; lat: number; lon: number; kind: string }[] = [];

      /* Local first, because it answers from the third keystroke. */
      const { data: hits } = await supabase
        .from("stations")
        .select("name, lat, lon")
        .eq("system_slug", system.slug)
        .ilike("name", `%${q}%`)
        .limit(4);
      if (cancelled) return;
      for (const h of hits ?? []) {
        if (h.name && h.lat !== null && h.lon !== null) {
          out.push({ label: h.name, lat: h.lat, lon: h.lon, kind: "dock" });
        }
      }

      /* Then the geocoder, for neighbourhoods and addresses it can place. */
      try {
        const res = await fetch(
          `/api/place?q=${encodeURIComponent(q)}&lat=${centre.lat}&lon=${centre.lon}`,
        );
        if (!cancelled && res.ok) {
          const { places } = (await res.json()) as {
            places: { lat: number; lon: number; label: string }[];
          };
          for (const pl of places) {
            if (metresBetween(centre, pl) < 60_000 && out.length < 7) {
              out.push({ ...pl, kind: "place" });
            }
          }
        }
      } catch {
        /* Geocoder unreachable is not a dead end — the local hits stand. */
      }

      if (!cancelled) setCandidates(out);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft, supabase, system]);

  function add(place: { label: string; lat: number; lon: number }) {
    /* Adding somewhere already on the list is a no-op rather than an error —
       the same rule the packing list follows for a repeated item. */
    if (
      !trip.stayingPlaces.some(
        (p) => p.label.toLowerCase() === place.label.toLowerCase(),
      )
    ) {
      onAddPlace(place);
    }
    setDraft("");
    setCandidates([]);
    setAdding(false);
    setError(undefined);
  }

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
      add({ label: hit.label, lat: hit.lat, lon: hit.lon });
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
          No docked bikeshare in {trip.destination}. Any city with a public
          GBFS feed works here — this one either has none, or runs scooters
          rather than docks.
        </p>
      </TripSection>
    );
  }

  const state: Freshness = freshnessOf(latestRun, lastOkRun);
  const places = trip.stayingPlaces;
  const showForm = adding || places.length === 0;

  return (
    <TripSection
      title={`Live bikes in ${system.city}`}
      meta={`${system.name} · updating itself`}
      note={places.length > 0 ? COUNTS_EXPLAINER : undefined}
    >
      {places.length > 0 && (
        <>
          <FreshnessLine state={state} line={freshnessLine(state, lastOkRun)} />

          {places.map((place) => {
            const docks = byPlace[place.label] ?? [];
            return (
              <div key={place.label} className="mt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-body text-ink">
                    Near <span className="font-semibold">{place.label}</span>
                  </span>
                  <QuietAction
                    onClick={() => onRemovePlace(place.label)}
                    label={`Stop watching bikes near ${place.label}`}
                    className="opacity-100 underline decoration-rule-strong underline-offset-2 hover:text-error"
                  >
                    Remove
                  </QuietAction>
                </div>

                {docks.length > 0 ? (
                  <ul className="mt-2 border border-rule-strong bg-surface shadow-raised">
                    {docks.map((s) => (
                      <li
                        key={s.station_id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-3 py-2 last:border-b-0"
                      >
                        <span className="text-ink">{s.name ?? s.station_id}</span>
                        <span className="flex items-baseline gap-3">
                          {s.lat !== null && s.lon !== null && (
                            <Label>
                              {distanceLabel(
                                metresBetween(place, { lat: s.lat, lon: s.lon }),
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
                            {s.bikes_available === null
                              ? "counting…"
                              : countsLabel(s)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="measure mt-2 text-small text-muted">
                    No docks within a few minutes&rsquo; walk of there.
                  </p>
                )}
              </div>
            );
          })}
        </>
      )}

      {showForm ? (
        <form onSubmit={save} noValidate className="mt-4 max-w-md">
          <Field
            label={places.length === 0 ? "Where are you staying?" : "Add a place"}
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

          <SuggestionList
            items={candidates.filter(
              (c) =>
                !trip.stayingPlaces.some(
                  (p) => p.label.toLowerCase() === c.label.toLowerCase(),
                ),
            )}
            getKey={(c) => c.label}
            onPick={(c) => add(c)}
          >
            {(c) => (
              <span className="flex items-baseline justify-between gap-3">
                <span>{c.label}</span>
                <span className="text-muted">
                  {c.kind === "dock" ? "dock" : "area"}
                </span>
              </span>
            )}
          </SuggestionList>

          <span className="mt-3 flex items-center gap-3">
            <Button type="submit">{saving ? "Finding…" : "Add"}</Button>
            {places.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDraft("");
                  setAdding(false);
                  setError(undefined);
                }}
              >
                Cancel
              </Button>
            )}
          </span>
        </form>
      ) : (
        /* Adding a second neighbourhood is comparing two, which is half of
           what the counts are for — so it is an always-visible invitation,
           not something folded away. */
        <QuietAction
          onClick={() => setAdding(true)}
          label="Add another place to watch"
          className="mt-4 inline-block opacity-100 underline decoration-rule-strong underline-offset-4 hover:text-ink"
        >
          + Add another place
        </QuietAction>
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
