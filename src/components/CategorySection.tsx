"use client";

import { ItemRow } from "./ItemRow";
import { PackCount } from "./PackProgress";
import { styleFor } from "./categoryStyle";
import { QuietAction } from "./Controls";
import type { Item, ItemCategory } from "@/lib/types";

/**
 * One category of the manifest, with its own tally and its own ink.
 *
 * Per-section counts matter more than they look: "Outerwear 0 / 2" tells you
 * the coat is still in the wardrobe, which a single overall percentage buries.
 * The colour does the same job for scanning — on a 24-item list you find the
 * section you're standing in front of without reading the headings.
 *
 * A finished section says so, because the whole experience of packing is
 * closing things out one at a time.
 */

export function CategorySection({
  category,
  items,
  ownedFor,
  onToggle,
  onQty,
  onRemove,
  onAddHere,
}: {
  category: ItemCategory;
  items: Item[];
  /** How many of this you own, when that's short of what the list wants. */
  ownedFor?: (item: Item) => number | undefined;
  onToggle: (itemId: string) => void;
  onQty: (itemId: string, qty: number) => void;
  onRemove: (itemId: string) => void;
  /** Add something to *this* category without hunting for the form. */
  onAddHere?: () => void;
}) {
  if (items.length === 0) return null;

  const packed = items.filter((i) => i.packed).length;
  const done = packed === items.length;
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

        <span className="flex items-baseline gap-3">
          {onAddHere && (
            /* Always visible, unlike the row-level QuietActions that reveal on
               hover: this is an invitation, not a destructive afterthought.
               The feedback was that adding to a category meant scrolling to
               the bottom of a long list and then picking the category again. */
            <QuietAction
              onClick={onAddHere}
              label={`Add something to ${category}`}
              className="opacity-100 hover:text-ink"
            >
              <span style={{ color: style.hue }}>+ Add</span>
            </QuietAction>
          )}
          {done && (
            <span
              className="font-sans text-label uppercase"
              style={{ color: style.hue }}
            >
              Done
            </span>
          )}
          <PackCount packed={packed} total={items.length} />
        </span>
      </div>

      <ul className="px-2.5">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            owned={ownedFor?.(item)}
            onToggle={() => onToggle(item.id)}
            onQty={(qty) => onQty(item.id, qty)}
            onRemove={() => onRemove(item.id)}
          />
        ))}
      </ul>
    </section>
  );
}
