"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Field, Select, TextInput, focusFirstError } from "./Field";
import { Label } from "./Card";
import { Chip } from "./Controls";
import { styleFor } from "./categoryStyle";
import type { Item, ItemCategory } from "@/lib/types";
import { CATEGORY_ORDER } from "@/lib/types";

/**
 * Add something the list didn't think of — either by typing it, or by picking
 * from the inventory you already keep.
 *
 * The inventory picker matters more than it looks: without it, Inventory is a
 * read-only report, and the things you own have no way of reaching the trip
 * you're packing for. With it, the two halves of the app actually connect.
 *
 * Two error states, both beside the field and both phrased as what to do next.
 * On a failed submit the typed value stays put — the whole point is that you
 * don't retype anything.
 *
 * **Typing something already on the list is not one of those errors.** It used
 * to be: "T Shirt is already on this list." — which is the same wrong answer
 * the inventory form used to give to the same reasonable request, and which
 * Assignment 3's feedback already called out there. Two problems with it. It
 * refused a sensible intent ("I want another T-shirt"), on a list whose every
 * row carries a quantity stepper for exactly that. And it never said *where*
 * the thing already was, so on a twenty-item list across seven sections you
 * were sent hunting — the row can easily be under Extras while you're looking
 * at Clothing.
 *
 * So a repeat now adds one to the row that exists and says so, naming its
 * section. Same gesture, same outcome as nudging its stepper, no error at all.
 * See AddKitForm, which resolves the identical case the identical way.
 */

const NEW_CATEGORY = "__new__";

export type InventoryOption = { label: string; category: ItemCategory };

export function AddItemForm({
  existingItems,
  existingCategories,
  inventoryOptions = [],
  onAdd,
  onBump,
  jumpTo,
}: {
  /** The list as it stands — needed whole, not as labels, so a repeat can add
      to the row that's already there. */
  existingItems: Item[];
  /** Custom categories already on this trip, so they can be reused. */
  existingCategories?: ItemCategory[];
  /** Things in your inventory that aren't on this list yet. */
  inventoryOptions?: InventoryOption[];
  onAdd: (item: Item) => void;
  /** One more of something the list already has. */
  onBump: (item: Item) => void;
  /** Set by a category's "+ Add": preselect it, then focus and scroll here.
   *  `nonce` exists so tapping the same category twice still moves focus. */
  jumpTo?: { category: string; nonce: number };
}) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<string>("Extras");
  const [customCategory, setCustomCategory] = useState("");
  const [error, setError] = useState<string>();
  const [categoryError, setCategoryError] = useState<string>();
  /* One line of feedback for both outcomes — a new row, or one more of a row
     that was already there. It holds the whole sentence rather than a label,
     because those two cases don't say the same thing. */
  const [note, setNote] = useState<string>();
  const [browsing, setBrowsing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  /* Jumping rather than rendering a form per section. Eight inline forms is
     eight sets of state and eight tab stops through a list someone is trying
     to read; one form that comes to you keeps the page quiet. */
  useEffect(() => {
    if (!jumpTo) return;
    setCategory(jumpTo.category);
    const form = formRef.current;
    if (!form) return;
    form.scrollIntoView({ block: "center", behavior: "smooth" });
    form.querySelector<HTMLInputElement>("input")?.focus();
  }, [jumpTo]);

  const extras = (existingCategories ?? []).filter(
    (c) => !CATEGORY_ORDER.includes(c),
  );
  const choosingNew = category === NEW_CATEGORY;

  function add(itemLabel: string, itemCategory: ItemCategory) {
    onAdd({
      id: crypto.randomUUID(),
      label: itemLabel,
      qty: 1,
      category: itemCategory,
      source: "manual",
      packed: false,
    });
    setNote(`Added ${itemLabel}. It'll be here next time too.`);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    const trimmed = label.trim();
    if (!trimmed) {
      setError("Name the item you want to add.");
      queueMicrotask(() => focusFirstError(formRef.current));
      return;
    }
    /* Already on the list? Add one to it rather than refusing. The category
       they picked is ignored on purpose: the row keeps the section it's in,
       and the note says which, so nothing moves under them. */
    const already = existingItems.find(
      (i) => i.label.toLowerCase() === trimmed.toLowerCase(),
    );
    if (already) {
      onBump(already);
      setNote(
        `${already.label} → ${already.qty + 1}, in ${already.category}.`,
      );
      setLabel("");
      setError(undefined);
      setCategoryError(undefined);
      return;
    }

    const resolved = choosingNew ? customCategory.trim() : category;
    if (choosingNew && !resolved) {
      setCategoryError("Name the new category.");
      queueMicrotask(() => focusFirstError(formRef.current));
      return;
    }

    add(trimmed, resolved);
    setLabel("");
    setError(undefined);
    setCategoryError(undefined);
    // Keep the new category selected so several things can go into it in a row.
    if (choosingNew) {
      setCategory(resolved);
      setCustomCategory("");
    }
  }

  return (
    <div>
      <form ref={formRef} onSubmit={submit} noValidate>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <Field label="Add an item" error={error}>
              {(props) => (
                <TextInput
                  {...props}
                  value={label}
                  placeholder="Laundry sheets"
                  onChange={(e) => {
                    setLabel(e.target.value);
                    // Clear the error as soon as they start fixing it.
                    if (error) setError(undefined);
                    if (note) setNote(undefined);
                  }}
                />
              )}
            </Field>
          </div>

          <div className="sm:w-52">
            <Field label="Where it goes" error={categoryError}>
              {(props) => (
                <>
                  <Select
                    {...props}
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      if (categoryError) setCategoryError(undefined);
                    }}
                  >
                    {[...CATEGORY_ORDER, ...extras].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value={NEW_CATEGORY}>A new category…</option>
                  </Select>

                  {choosingNew && (
                    <TextInput
                      value={customCategory}
                      autoFocus
                      aria-label="Name the new category"
                      placeholder="Climbing gear"
                      className="mt-2"
                      onChange={(e) => {
                        setCustomCategory(e.target.value);
                        if (categoryError) setCategoryError(undefined);
                      }}
                    />
                  )}
                </>
              )}
            </Field>
          </div>

          <Button type="submit" variant="primary" className="sm:mt-[29px]">
            Add
          </Button>
        </div>
      </form>

      {/* Confirmation, announced politely rather than interrupting. */}
      <p aria-live="polite" className="text-small text-success">
        {note ?? ""}
      </p>

      {inventoryOptions.length > 0 && (
        <div className="mt-2">
          <Button
            variant="quiet"
            aria-expanded={browsing}
            onClick={() => setBrowsing((b) => !b)}
          >
            {browsing
              ? "Hide your inventory"
              : `Or choose from your inventory (${inventoryOptions.length})`}
          </Button>

          {browsing && (
            <div className="mt-3 border border-rule bg-surface p-3">
              <Label>Not on this list yet</Label>
              <ul className="mt-2 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                {inventoryOptions.map((option) => {
                  const style = styleFor(option.category);
                  return (
                    <li key={option.label}>
                      <Chip
                        swatch={style.hue}
                        onClick={() => add(option.label, option.category)}
                        label={`Add ${option.label.toLowerCase()} to this list`}
                      >
                        {option.label}
                      </Chip>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
