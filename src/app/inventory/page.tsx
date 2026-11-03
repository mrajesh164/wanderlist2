"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTrips } from "@/app/providers";
import { Badge, Label, SectionRule } from "@/components/Card";
import { AddKitForm } from "@/components/AddKitForm";
import { QuietAction, SegmentedControl, Stepper } from "@/components/Controls";
import { WhenNeeded } from "@/components/WhenNeeded";
import { styleFor } from "@/components/categoryStyle";
import {
  categoriesPresent,
  type ItemCategory,
  type WhenTag,
} from "@/lib/types";
import { buildInventory, type KitEntry } from "@/lib/inventory";
import { formatDateRange, phaseOf, sortForBoard } from "@/lib/trips";

/**
 * Everything you own and everything Wanderlist has learned about it.
 *
 * Two views rather than three named buckets: the sorting *is* the insight.
 * "Packed most" is the kit you actually rely on; "packed least" is the stuff
 * riding along in the bottom of the bag. The counts speak for themselves, so
 * they don't need a headline telling you what to think about them.
 */

/**
 * "Packed least" used to be a reverse sort, which barely did anything: the page
 * groups by category *after* sorting and categories render in a fixed order, so
 * flipping the flat list moved almost nothing on screen. Worse, with one trip
 * and nothing ticked every row read identically and the toggle looked broken.
 *
 * "Never used" is a filter instead, and an actionable one — things that have
 * been on a list and never once made it into the bag are exactly what's worth
 * retiring.
 */
type View = "most" | "unused";

export default function InventoryPage() {
  const { trips, kit, ready, addKitItems, setKitQty, setKitWhen, removeKitItem } =
    useTrips();
  const [view, setView] = useState<View>("most");

  /* Guarded on `ready` because these reach phaseOf -> todayISO -> new Date(),
     and Cache Components refuses to bake a prerender-time clock reading into
     static HTML. `ready` is false during prerender, so nothing calls Date. */
  const entries = useMemo(
    () => (ready ? buildInventory(trips, kit) : []),
    [ready, trips, kit],
  );

  /* buildInventory already returns most-packed first. */
  const neverUsed = useMemo(
    () => entries.filter((e) => e.packedTimes === 0 && e.onTrips > 0),
    [entries],
  );

  const ordered = useMemo(
    () => (view === "most" ? entries : neverUsed),
    [entries, neverUsed, view],
  );

  const categories = useMemo(
    () => categoriesPresent(ordered.map((e) => e.category)),
    [ordered],
  );

  const pastTrips = useMemo(
    () =>
      ready ? sortForBoard(trips).filter((t) => phaseOf(t) === "past") : [],
    [ready, trips],
  );

  if (!ready) return <div aria-hidden="true" className="h-64" />;

  return (
    <>
      <h1 className="font-display text-heading text-ink">Your Inventory</h1>

      <AddKitForm
        existing={entries.map((e) => ({
          label: e.label,
          qty: e.qty,
          category: e.category,
        }))}
        existingCategories={categories}
        onAdd={addKitItems}
        onSetQty={setKitQty}
      />

      {entries.length === 0 ? (
        <p className="measure mt-8 text-body text-muted">
          Nothing here yet. Add what you own above, or pack a trip and the
          things you carry will show up on their own.
        </p>
      ) : (
        <>
          <SectionRule className="mt-10" />

          {/* No second heading: "Your Inventory" at the top already names this,
              and "Everything" under a rule read as a different page. */}
          <div className="mt-4 flex flex-wrap items-baseline justify-end gap-3">
            <SegmentedControl
              value={view}
              onChange={setView}
              label="Sort the inventory"
              options={[
                ["most", "Packed most"],
                ["unused", `Never used${neverUsed.length ? ` (${neverUsed.length})` : ""}`],
              ] as const}
            />
          </div>

          {view === "unused" && (
            <p className="measure mt-4 text-small text-muted">
              {neverUsed.length === 0
                ? "Nothing here — everything on your lists has been packed at least once."
                : "On a list at least once, never actually packed. Worth retiring, or worth remembering next time."}
            </p>
          )}

          <div className="mt-5">
            {categories.map((category) => (
              <KitCategory
                key={category}
                category={category}
                entries={ordered.filter((e) => e.category === category)}
                onSetQty={setKitQty}
                onSetWhen={setKitWhen}
                onRemove={removeKitItem}
              />
            ))}
          </div>
        </>
      )}

      {pastTrips.length > 0 && (
        <>
          <SectionRule className="mt-10" />
          <h2 className="mt-4 font-display text-heading text-ink">
            What you took
          </h2>
          <p className="mt-1 text-small text-muted">
            Trips you&apos;ve finished, and what actually went in the bag.
          </p>

          <div className="mt-5">
            {pastTrips.map((trip) => {
              const packed = trip.items.filter((i) => i.packed);
              return (
                <section key={trip.id} className="mb-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-rule-strong pb-1">
                    <h3 className="font-display text-subhead text-ink">
                      <Link
                        href={`/trips/${trip.id}`}
                        className="text-ink no-underline hover:text-accent"
                      >
                        {trip.name}
                      </Link>
                    </h3>
                    <Label>
                      {trip.destination} ·{" "}
                      {formatDateRange(trip.startDate, trip.endDate)}
                    </Label>
                  </div>

                  {packed.length > 0 ? (
                    <p className="measure mt-2 text-small text-ink">
                      {packed.map((i) => i.label).join(", ")}
                    </p>
                  ) : (
                    <p className="mt-2 text-small text-muted">
                      Nothing was ticked off on this one.
                    </p>
                  )}

                  <p className="mt-1.5 text-small text-muted">
                    {packed.length} of {trip.items.length} packed
                    {trip.review
                      ? ` · reviewed, ${trip.learned.drop.length} retired`
                      : ""}
                  </p>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function KitCategory({
  category,
  entries,
  onSetQty,
  onSetWhen,
  onRemove,
}: {
  category: ItemCategory;
  entries: KitEntry[];
  onSetQty: (label: string, category: ItemCategory, qty: number) => void;
  onSetWhen: (
    label: string,
    category: ItemCategory,
    alwaysNeeded: boolean,
    whenTags: WhenTag[],
  ) => void;
  onRemove: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  const style = styleFor(category);

  return (
    <section className="mb-6">
      <div
        className="flex items-baseline justify-between px-2.5 py-1.5"
        style={{
          backgroundColor: style.tint,
          borderBottom: `2px solid ${style.hue}`,
        }}
      >
        <h3
          className="flex items-center gap-2 font-sans text-label uppercase"
          style={{ color: style.hue }}
        >
          <span
            aria-hidden="true"
            className="inline-block size-2.5"
            style={{ backgroundColor: style.hue }}
          />
          {category}
        </h3>
        <span className="font-sans text-label uppercase text-muted">
          {entries.length}
        </span>
      </div>

      <ul className="px-2.5">
        {entries.map((entry) => (
          <li
            key={entry.label}
            className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 border-b border-rule py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_185px_175px_72px_92px]"
          >
            <span
              className={`text-body ${
                entry.dropped
                  ? "text-muted line-through decoration-rule-strong"
                  : "text-ink"
              }`}
            >
              {entry.label}
            </span>

            <span className="hidden text-small text-muted sm:block">
              {entry.onTrips === 0
                ? "Not packed yet"
                : entry.packedTimes === 0
                  ? `Never packed, on ${entry.onTrips} ${entry.onTrips === 1 ? "list" : "lists"}`
                  : `Packed on ${entry.packedTimes} of ${entry.onTrips} ${entry.onTrips === 1 ? "trip" : "trips"}`}
              {/* Shown whenever there's packing evidence, not just when it won.
                  It explains both the row that reads higher than the 1 you
                  accepted, and why the stepper on a row you set yourself won't
                  go below a certain number. A row with nothing behind it says
                  nothing — a 1 nobody chose doesn't deserve a footnote. */}
              {entry.packedMax > 0 && (
                <span className="block text-muted">
                  You&apos;ve packed {entry.packedMax}
                </span>
              )}
            </span>

            <span className="flex flex-wrap items-center gap-2 sm:justify-start">
              {/* One badge where there were two.

                  "Yours" and "Asked for" split hairs the page doesn't need
                  split. "Yours" meant the label has a row in `kit_items`;
                  "Asked for" meant some trip learned it from a review or a
                  hand-added item. Both answer the same question — did a person
                  put this here, or did the generator? — and on a page already
                  titled "Your Inventory", "Yours" barely said anything at all.
                  Two badges on that axis, next to two more about usefulness
                  (Retired, Never used), made four vocabularies to learn per row.

                  Collapsing them is also truer to the app: adding an item does
                  three things at once (trip, `learned.add`, inventory), so one
                  gesture should not produce two different labels depending on
                  which door it came through. What's lost is form-versus-review
                  provenance, which nothing on this page acts on. */}
              {(entry.owned || entry.yourOwn || entry.requested) && (
                <Badge tone="accent">Added by you</Badge>
              )}
              {entry.dropped && <Badge>Retired</Badge>}
              <WhenNeeded
                label={entry.label}
                alwaysNeeded={entry.alwaysNeeded}
                whenTags={entry.whenTags}
                onChange={(always, tags) =>
                  onSetWhen(entry.label, entry.category, always, tags)
                }
              />
              {!entry.dropped &&
                entry.unpackedOnFinished > 0 &&
                entry.packedTimes === 0 && (
                  <Badge tone="warning">Never used</Badge>
                )}
            </span>

            <span className="hidden justify-self-end sm:block">
              {entry.kitId && (
                <QuietAction
                  onClick={() => onRemove(entry.kitId!)}
                  label={`Remove ${entry.label.toLowerCase()} from your inventory`}
                >
                  Remove
                </QuietAction>
              )}
            </span>

            {/* The same stepper the packing list uses, on every row whether or
                not this is something you've explicitly listed. Nudging it is
                how a derived row becomes a counted one — there's no separate
                step for claiming something as yours. */}
            <span className="flex justify-end sm:justify-self-end">
              <Stepper
                value={entry.qty}
                /* Can't go below what you've actually packed at once — the
                   stepper would appear to accept it and resolveQty would put it
                   straight back, which looks like a bug. */
                min={Math.max(1, entry.packedMax)}
                onChange={(qty) => onSetQty(entry.label, entry.category, qty)}
                noun={entry.label.toLowerCase()}
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
