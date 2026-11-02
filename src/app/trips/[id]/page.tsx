"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTrips } from "@/app/providers";
import { Button, ButtonLink } from "@/components/Button";
import { Card, Label } from "@/components/Card";
import { CategorySection } from "@/components/CategorySection";
import { AddItemForm } from "@/components/AddItemForm";
import { InlineAddItem } from "@/components/InlineAddItem";
import { Checkbox } from "@/components/Field";
import { PackCount, PackProgress } from "@/components/PackProgress";
import { SavedNote } from "@/components/SavedNote";
import { MONTHS, bandFor, wetnessFor } from "@/lib/climate";
import { useTripClimate } from "@/lib/use-climate";
import { monthsForApi } from "@/lib/trip-days";
import { ConditionsNote } from "@/components/ConditionsNote";
import { EditDates } from "@/components/EditDates";
import { DestinationArt } from "@/components/DestinationArt";
import { LAUNDRY_CAP_DAYS, monthsSpanned } from "@/lib/suggestions";
import {
  conditionsOf,
  countdownLabel,
  formatDateRange,
  lengthOf,
  packedCount,
  phaseOf,
} from "@/lib/trips";
import { categoriesPresent, type Item } from "@/lib/types";
import { buildInventory, ownedCounts, shortfall } from "@/lib/inventory";
import { StationBoard } from "@/components/StationBoard";
import { DayPlan } from "@/components/DayPlan";
import { citySlugFor } from "@/lib/places";
import { tripDays } from "@/lib/trip-days";

/**
 * The checklist. The core task, and the screen this app exists for.
 *
 * Packing happens over several evenings rather than in one sitting, so this
 * page is built to be left and come back to: the filter persists, nothing is
 * ever cleared, and the board outside advertises what's left.
 */

export default function TripPage() {
  /* useParams suspends here: [id] isn't known at build time, so the route can't
     resolve it while prerendering. The boundary lets the static shell render. */
  return (
    <Suspense fallback={<div aria-hidden="true" className="h-64" />}>
      <Checklist />
    </Suspense>
  );
}

function Checklist() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const {
    trips,
    kit,
    ready,
    toggleItem,
    setItemQty,
    addItem,
    removeItem,
    removeTrip,
    updateTrip,
  } = useTrips();

  const trip = trips.find((t) => t.id === id);

  /**
   * The external API, called up here with the rest of the hooks because hooks
   * can't sit behind the early returns below. The hook returns `idle` for an
   * absent destination, so asking before we know the trip exists is harmless.
   *
   * Server-side and cached — see app/api/climate/route.ts for why there rather
   * than in the browser.
   */
  /* Every month the trip touches, not just its first — a trip across a
     boundary needs both to draw a complete strip. */
  const tripMonths = trip ? monthsForApi(trip.startDate, trip.endDate) : [];
  const live = useTripClimate(trip?.destination, tripMonths);

  /* "Hide what's packed" survives a reload, so reopening mid-pack lands you back
     in the same view rather than at the top of a list you'd already narrowed. */
  const filterKey = `wanderlist.filter.${id}`;
  const legacyFilterKey = `departure-board.filter.${id}`;
  const [hidePacked, setHidePacked] = useState(false);
  /* Same constraint as the provider: this value only exists on the client, so
     it can't be a lazy initializer without desynchronising from the server
     render. Reading it in an effect is the correct trade here. */
  useEffect(() => {
    try {
      // Falls back to the pre-rename key; see LEGACY_STORAGE_KEY in lib/storage.
      const saved =
        localStorage.getItem(filterKey) ?? localStorage.getItem(legacyFilterKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHidePacked(saved === "1");
    } catch {
      /* private browsing — the default is fine */
    }
  }, [filterKey, legacyFilterKey]);

  function toggleFilter(next: boolean) {
    setHidePacked(next);
    try {
      localStorage.setItem(filterKey, next ? "1" : "0");
    } catch {
      /* nothing to do */
    }
  }

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /* Which section has its inline add box open. The form at the foot of the
     list stays regardless — that one can invent a new category and is where
     you go when you don't know where a thing belongs. */
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmingDelete) confirmRef.current?.focus();
  }, [confirmingDelete]);

  if (!ready) return <div aria-hidden="true" className="h-64" />;

  if (!trip) {
    return (
      <>
        <h1 className="font-display text-heading text-ink">
          That trip isn&apos;t here
        </h1>
        <p className="measure mt-2 text-body text-muted">
          It may have been removed, or saved in a different browser — everything
          lives on the device you created it on.
        </p>
        <ButtonLink href="/trips" className="mt-5">
          See upcoming trips
        </ButtonLink>
      </>
    );
  }

  const { packed, total } = packedCount(trip.items);
  const left = total - packed;
  const allPacked = total > 0 && left === 0;
  const days = lengthOf(trip);
  const phase = phaseOf(trip);

  const month = MONTHS[monthsSpanned(trip.startDate, trip.endDate)[0]!];

  /**
   * Real numbers win over the built-in table when we have them.
   *
   * This is what makes the API load-bearing rather than decorative: the band
   * and wetness that decide what goes on the list are derived from fifteen
   * years of recorded weather for *this* destination, not from a 35-city table
   * that had to be edited by hand. When the lookup fails we fall back to that
   * table, which is exactly what it's now for.
   */
  const conditions =
    live.state === "ok"
      ? {
          highC: live.highC,
          lowC: live.lowC,
          rainDays: live.rainDays,
          band: bandFor(live.highC),
          wetness: wetnessFor(live.rainDays),
          /* Drives the outerwear call, so it has to come from the real low
             rather than being left to default. */
          freezes: live.lowC <= 0,
        }
      : conditionsOf(trip);

  /* Everything in the inventory that isn't already on this list, so the picker
     only ever offers something useful. */
  const onThisList = new Set(trip.items.map((i) => i.label.toLowerCase()));
  const inventory = buildInventory(trips, kit);
  const inventoryOptions = inventory
    .filter((e) => !e.dropped && !onThisList.has(e.label.toLowerCase()))
    .map((e) => ({ label: e.label, category: e.category }));

  /* What you own, for the rows where the list asks for more than that. */
  const owned = ownedCounts(inventory);
  const ownedFor = (item: Item) =>
    shortfall(item.qty, owned.get(item.label.toLowerCase())) !== undefined
      ? owned.get(item.label.toLowerCase())!.qty
      : undefined;

  const visible = hidePacked ? trip.items.filter((i) => !i.packed) : trip.items;

  function finish() {
    updateTrip(trip!.id, (t) => ({ ...t, completedAt: new Date().toISOString() }));
    router.push(`/trips/${trip!.id}/review`);
  }

  return (
    <>
      {/* --- header --- */}
      {conditions && (
        <DestinationArt
          seed={trip.destination}
          slug={trip.climateSlug}
          city={trip.destination}
          conditions={conditions}
          height={150}
          className="mb-5"
        />
      )}


      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Label>{countdownLabel(trip)}</Label>
        <Label>
          {trip.destination} · {formatDateRange(trip.startDate, trip.endDate)} ·{" "}
          {days} days
        </Label>
      </div>

      <h1 className="mt-1 font-display text-heading text-ink">{trip.name}</h1>

      {conditions && (
        <ConditionsNote
          conditions={conditions}
          month={month}
          destination={trip.destination}
          source={trip.climateSlug ? "climate" : "manual"}
          live={live}
          startDate={trip.startDate}
          endDate={trip.endDate}
        />
      )}

      {/* Where you'll be each day, built from the same per-day normals the
          strip above draws. Sits before the bikes panel because the plan is
          what the bikes are *for* — "how do I get to Tuesday" only means
          something once Tuesday has somewhere to be. */}
      {live.state === "ok" && (
        <DayPlan
          citySlug={citySlugFor(trip.destination)}
          days={tripDays(trip.startDate, trip.endDate, live.byMonth)}
        />
      )}

      {/* Live bikes at the destination. Sits here, with the conditions strip
          and before the packing list, because it answers "what is it like
          there" rather than "what should I bring" — a peer of the climate
          half of this page, not an appendix to the list. */}
      <StationBoard destination={trip.destination} />

      {/* --- progress --- */}
      {total > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <Label>{allPacked ? "All packed" : `${left} still to pack`}</Label>
            <span className="flex items-baseline gap-3">
              <SavedNote watch={`${packed}/${total}`} />
              <PackCount packed={packed} total={total} />
            </span>
          </div>
          <PackProgress packed={packed} total={total} />

          {/* Said once, here, and only when it actually binds.
              Clothing counts stop growing after ten days, which is right — you
              do laundry instead of carrying three weeks of socks — but silently
              right. Change a long trip's dates and "Trousers 4" becomes 5 while
              "Underwear 11" doesn't move, which reads as a broken rebuild. A
              rule nobody states is indistinguishable from a bug.

              Not a per-row note: those were tried and removed, because the same
              sentence repeated down every climate-driven row said nothing the
              header hadn't already said better. */}
          {days > LAUNDRY_CAP_DAYS && (
            <p className="measure mt-2 text-small text-muted">
              Clothing counts stop at {LAUNDRY_CAP_DAYS} days — on a trip this
              long you&apos;ll do laundry rather than pack more, so those
              numbers stay put if you move the dates.
            </p>
          )}
        </div>
      )}

      {/* Completion, announced politely rather than shouted. */}
      <p aria-live="polite" className="mt-4 text-body text-success">
        {allPacked ? "Packed. Have a good trip." : ""}
      </p>

      {allPacked && phase !== "past" && (
        <Card className="mt-2">
          <p className="measure text-body text-ink">
            When you&apos;re back, two quick questions will make the next one
            better.
          </p>
          <Button variant="secondary" className="mt-3" onClick={finish}>
            I&apos;m back — review this trip
          </Button>
        </Card>
      )}

      {/* --- the filter --- */}
      {total > 0 && (
        <label className="mt-6 flex cursor-pointer items-center gap-2 text-small text-ink">
          <Checkbox
            checked={hidePacked}
            onChange={(e) => toggleFilter(e.target.checked)}
          />
          Hide what&apos;s packed
        </label>
      )}

      {/* --- the list --- */}
      <div className="mt-5">
        {categoriesPresent(trip.items.map((i) => i.category)).map((category) => (
          <CategorySection
            key={category}
            category={category}
            items={visible.filter((i) => i.category === category)}
            ownedFor={ownedFor}
            onToggle={(itemId) => toggleItem(trip.id, itemId)}
            onQty={(itemId, qty) => setItemQty(trip.id, itemId, qty)}
            onRemove={(itemId) => removeItem(trip.id, itemId)}
            adding={addingTo === category}
            onAddHere={() =>
              setAddingTo((open) => (open === category ? null : category))
            }
            addForm={
              <InlineAddItem
                category={category}
                existingItems={trip.items}
                onAdd={(item) => addItem(trip.id, item)}
                onBump={(item) => setItemQty(trip.id, item.id, item.qty + 1)}
                onClose={() => setAddingTo(null)}
              />
            }
          />
        ))}

        {hidePacked && visible.length === 0 && total > 0 && (
          <p className="text-body text-muted">
            Nothing left. Untick the filter to see the whole list again.
          </p>
        )}

        {total === 0 && (
          <p className="measure text-body text-muted">
            This list is empty. Add what you need below — it&apos;ll be
            remembered for next time.
          </p>
        )}
      </div>

      {/* --- add your own --- */}
      <div className="mt-8 border-t-2 border-ink pt-5">
        <AddItemForm
          existingItems={trip.items}
          existingCategories={categoriesPresent(
            trip.items.map((i) => i.category),
          )}
          inventoryOptions={inventoryOptions}
          onAdd={(item) => addItem(trip.id, item)}
          /* Same thing the row's own stepper does — which is the point: asking
             for a second T-shirt should not depend on which control you reach
             for. */
          onBump={(item) => setItemQty(trip.id, item.id, item.qty + 1)}
        />
      </div>

      {/* --- housekeeping ---
          Order matters here and it was wrong. "Delete trip" sat in the
          rightmost slot — the end of the left-to-right progression, which
          reads as *continue* — while "Done", the actual forward action, was
          bottom-left. Destructive work now sits on the left, apart and
          behind a confirm; the forward action ends the row, where the eye
          finishes. */}
      <div className="mt-10 border-t border-rule pt-4">
        <div className="flex flex-wrap items-start gap-3">
          <span>
            {confirmingDelete ? (
              <span className="flex flex-wrap items-center gap-3">
                <span className="text-small text-ink">Delete this trip?</span>
                <Button
                  ref={confirmRef}
                  variant="danger"
                  onClick={() => {
                    removeTrip(trip.id);
                    router.push("/trips");
                  }}
                >
                  Delete
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep it
                </Button>
              </span>
            ) : (
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                Delete trip
              </Button>
            )}
          </span>

          {phase !== "past" && <EditDates trip={trip} />}

          {phase !== "past" && !allPacked && (
            <Button variant="secondary" onClick={finish}>
              Mark this trip finished
            </Button>
          )}

          <span className="ml-auto">
            <ButtonLink href="/trips" variant="primary">
              Done
            </ButtonLink>
          </span>
        </div>
      </div>
    </>
  );
}
