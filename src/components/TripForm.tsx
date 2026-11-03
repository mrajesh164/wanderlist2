"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./Button";
import { Field, Select, TextInput, focusFirstError } from "./Field";
import { Label } from "./Card";
import { SuggestionList } from "./Controls";
import { useTrips } from "@/app/providers";
import {
  BAND_LABEL,
  CLIMATES,
  MONTHS,
  WETNESS_LABEL,
  conditionsFor,
  describeConditions,
  findClimate,
  manualConditions,
  type TempBand,
  type Wetness,
} from "@/lib/climate";
import {
  buildPackingList,
  monthsSpanned,
  tripLengthDays,
} from "@/lib/suggestions";
import type { Trip } from "@/lib/types";

/**
 * One column, a label on every field, and errors that sit beside the field they
 * belong to and say what to do next.
 *
 * Validation runs on submit against React state and only ever *sets* errors —
 * it never touches the values — so a failed submit keeps everything typed.
 */

type Errors = Partial<
  Record<"name" | "destination" | "startDate" | "endDate", string>
>;

export function TripForm({
  repeatOf,
  preset,
}: {
  /** Repeating a finished trip: carries its name and place, but not its dates. */
  repeatOf?: Trip;
  /**
   * A starter someone picked before signing in, which *does* carry dates.
   *
   * The difference is the point. Repeating "Lisbon in March" means next March,
   * so inheriting last year's dates would be wrong. Picking "A week somewhere
   * warm" from the front door means the dates it advertised on the card — the
   * person has already seen "November 25 – December 1" and agreed to it.
   */
  preset?: Trip;
}) {
  const { addTrip, kit } = useTrips();
  const router = useRouter();

  const source = repeatOf ?? preset;

  const [name, setName] = useState(source?.name ?? "");
  const [destination, setDestination] = useState(source?.destination ?? "");
  const [climateSlug, setClimateSlug] = useState(source?.climateSlug ?? "");
  const [startDate, setStartDate] = useState(preset?.startDate ?? "");
  const [endDate, setEndDate] = useState(preset?.endDate ?? "");
  const [band, setBand] = useState<TempBand>(source?.manualBand ?? "mild");
  const [wetness, setWetness] = useState<Wetness>(
    source?.manualWetness ?? "some-rain",
  );
  const [errors, setErrors] = useState<Errors>({});
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * Resolve the destination to a climate from either an explicit pick or an
   * exact name match. Without the second half, typing "Minneapolis" in full and
   * pressing submit — rather than clicking the suggestion — silently fell
   * through to generic "mild" conditions for a city we have real data for.
   */
  const climate = useMemo(() => {
    if (climateSlug) return findClimate(climateSlug);
    const typed = destination.trim().toLowerCase();
    if (!typed) return undefined;
    return CLIMATES.find((c) => c.city.toLowerCase() === typed);
  }, [climateSlug, destination]);

  /**
   * Destinations come from the bikeshare registry, not the climate table.
   *
   * A trip can only be made somewhere the live layer will work, so the field
   * offers the 945 cities that publish a GBFS feed. Weather works everywhere
   * and is no longer the thing that limits the list, which is why the old
   * hint about "a few places" has gone.
   *
   * The trade-off, stated plainly: you can no longer make a trip to a village
   * in the Alps. That was possible before and is a real loss — chosen so that
   * anyone opening this app lands somewhere the live counts actually move.
   */
  const [matches, setMatches] = useState<
    { city: string; region: string; country: string }[]
  >([]);

  useEffect(() => {
    const q = destination.trim();
    if (q.length < 2 || climate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatches([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}`);
        if (cancelled) return;
        const { cities } = (await res.json()) as {
          cities?: { city: string; region: string; country: string }[];
        };
        setMatches(cities ?? []);
      } catch {
        if (!cancelled) setMatches([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [destination, climate]);

  /* The destination isn't in the table, so ask rather than guess. Not an error —
     a trip to a village in the Alps is a perfectly good trip. */
  /* Only once they have finished typing. Judging a half-typed destination
     put "WE DON'T KNOW DEL" on screen while someone was still reaching for
     "Delhi", which reads as the form arguing with you mid-word. */
  /* A destination only counts once it has been chosen from the list, so a
     trip cannot be made somewhere the live layer has nothing to show. */
  const [pickedFromList, setPickedFromList] = useState(
    Boolean(source?.destination),
  );
  const [destinationSettled, setDestinationSettled] = useState(
    Boolean(source?.destination),
  );
  const needsManualConditions =
    destinationSettled && destination.trim().length > 0 && !climate;

  /* Live preview: what this form is about to build. */
  const preview = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return undefined;
    const days = tripLengthDays(startDate, endDate);
    const conditions = climate
      ? conditionsFor(climate, monthsSpanned(startDate, endDate))
      : needsManualConditions
        ? manualConditions(band, wetness)
        : undefined;
    if (!conditions) return undefined;
    return {
      days,
      conditions,
      count: buildPackingList(conditions, days, repeatOf?.learned, kit, startDate)
        .length,
    };
  }, [startDate, endDate, climate, needsManualConditions, band, wetness, repeatOf, kit]);

  function pickDestination(city: string) {
    setDestinationSettled(true);
    setPickedFromList(true);
    /* The climate table still resolves where it can, so a city it knows keeps
       its offline normals; everywhere else fetches them when the trip opens. */
    setClimateSlug(findClimate(city)?.slug ?? "");
    setDestination(city);
    setErrors((e) => ({ ...e, destination: undefined }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    const next: Errors = {};
    if (!name.trim()) next.name = "Name this trip so you can find it again.";
    if (!destination.trim()) next.destination = "Enter a destination.";
    /* Phrased as an instruction, not a refusal: the list is the only way to
       reach a city the live layer can serve, so say to use it. */
    else if (!pickedFromList) {
      next.destination = "Choose a city from the list as you type.";
    }
    if (!startDate) next.startDate = "Pick a start date.";
    if (!endDate) next.endDate = "Pick an end date.";
    else if (startDate && endDate < startDate) {
      next.endDate = "End the trip on or after it starts.";
    }

    if (Object.keys(next).length > 0) {
      // Only errors change. Every typed value stays exactly where it is.
      setErrors(next);
      // Then send focus to the first one, so it's announced rather than just drawn.
      queueMicrotask(() => focusFirstError(formRef.current));
      return;
    }

    const days = tripLengthDays(startDate, endDate);
    const conditions = climate
      ? conditionsFor(climate, monthsSpanned(startDate, endDate))
      : manualConditions(band, wetness);

    const trip: Trip = {
      id: crypto.randomUUID(),
      name: name.trim(),
      destination: destination.trim(),
      climateSlug: climate ? climate.slug : undefined,
      manualBand: climate ? undefined : band,
      manualWetness: climate ? undefined : wetness,
      startDate,
      endDate,
      stayingPlaces: [],
      items: buildPackingList(conditions, days, repeatOf?.learned, kit, startDate),
      createdAt: new Date().toISOString(),
      // Carry the corrections forward — this is what makes a repeat cheap.
      learned: repeatOf?.learned ?? { drop: [], add: [] },
    };

    addTrip(trip);
    router.push(`/trips/${trip.id}`);
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="max-w-xl">
      {repeatOf && (
        <p className="mb-6 border-l-2 border-success bg-surface px-3 py-2 text-small text-ink">
          Packing <strong>{repeatOf.name}</strong> again. Your
          corrections from last time are already applied — just pick the new
          dates.
        </p>
      )}

      <Field
        label="What's the trip?"
        hint="However you'd refer to it: “Thanksgiving at my parents'”."
        error={errors.name}
      >
        {(props) => (
          <TextInput
            {...props}
            value={name}
            placeholder="Thanksgiving at my parents'"
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((x) => ({ ...x, name: undefined }));
            }}
          />
        )}
      </Field>

      <Field
        label="Where are you going?"
        hint="Start typing. These are the cities with live bikeshare."
        error={errors.destination}
      >
        {(props) => (
          <>
            <TextInput
              {...props}
              value={destination}
              autoComplete="off"
              placeholder="Lisbon"
              onChange={(e) => {
                setDestination(e.target.value);
                setClimateSlug("");
                setDestinationSettled(false);
                setPickedFromList(false);
                if (errors.destination) {
                  setErrors((x) => ({ ...x, destination: undefined }));
                }
              }}
              onBlur={() => setDestinationSettled(true)}
            />
            <SuggestionList
              items={matches}
              getKey={(c) => `${c.city}|${c.region}`}
              onPick={(c) => pickDestination(c.city)}
            >
              {(c) => (
                <>
                  {c.city}
                  <span className="text-muted">
                    {" · "}
                    {[c.region, c.country].filter(Boolean).join(", ")}
                  </span>
                </>
              )}
            </SuggestionList>
          </>
        )}
      </Field>

      <Field label="First day" error={errors.startDate}>
        {(props) => (
          <TextInput
            {...props}
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (errors.startDate) {
                setErrors((x) => ({ ...x, startDate: undefined }));
              }
            }}
          />
        )}
      </Field>

      <Field label="Last day" error={errors.endDate}>
        {(props) => (
          <TextInput
            {...props}
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => {
              setEndDate(e.target.value);
              if (errors.endDate) {
                setErrors((x) => ({ ...x, endDate: undefined }));
              }
            }}
          />
        )}
      </Field>

      {needsManualConditions && (
        <fieldset className="mb-6 border border-rule bg-surface p-4">
          {/* float-left with a full width drops the legend *inside* the box
              instead of straddling the top border, which is the browser
              default. Straddling put the label half on the page and half on
              the card — two different colours through one line of text, which
              reads as a rendering fault. The border runs unbroken now and the
              label sits where every other section label in the app sits. */}
          <legend className="float-left mb-3 w-full font-sans text-label uppercase tracking-[0.14em] text-muted">
            Roughly what to expect
          </legend>
          {/* The old legend echoed whatever had been typed, uppercased — "WE
              DON'T KNOW DEL" — which looked like a bug and overstated the
              problem. The app has typical weather for 35 places *offline*;
              everywhere else it fetches real normals from Open-Meteo when the
              trip opens. So this is only needed to build the first list, and
              saying so is both truer and less alarming than claiming
              ignorance of the place. */}
          <p className="measure mb-4 text-small text-muted">
            We don&apos;t have {destination.trim() || "that place"} saved
            offline, so tell us roughly what to expect and the first list will
            still be right. Real weather for your dates loads when you open the
            trip.
          </p>

          <Field label="How warm is it then?">
            {(props) => (
              <Select
                {...props}
                value={band}
                onChange={(e) => setBand(e.target.value as TempBand)}
              >
                {(Object.keys(BAND_LABEL) as TempBand[]).map((b) => (
                  <option key={b} value={b}>
                    {BAND_LABEL[b]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="And the rain?">
            {(props) => (
              <Select
                {...props}
                value={wetness}
                onChange={(e) => setWetness(e.target.value as Wetness)}
              >
                {(Object.keys(WETNESS_LABEL) as Wetness[]).map((w) => (
                  <option key={w} value={w}>
                    {WETNESS_LABEL[w]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </fieldset>
      )}

      {/* What the form is about to do, before it does it. */}
      {preview && (
        <div className="mb-6 border-t-2 border-ink pt-3">
          <Label>This builds</Label>
          <p className="measure mt-1 text-body text-ink">
            <strong>{preview.days} days</strong>
            {climate ? ` in ${climate.city}` : ""} ·{" "}
            {describeConditions(preview.conditions)}
          </p>
          <p className="mt-1 text-small text-muted">
            About {preview.count} items
            {climate
              ? `, based on ${MONTHS[monthsSpanned(startDate, endDate)[0]]} there.`
              : "."}
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <Button type="submit" variant="primary">
          Build the list
        </Button>
        <Button variant="quiet" onClick={() => router.push("/trips")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
