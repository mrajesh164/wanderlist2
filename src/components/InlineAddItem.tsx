"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Field, TextInput } from "./Field";
import type { Item, ItemCategory } from "@/lib/types";

/**
 * Add something to the section you are already looking at.
 *
 * The form at the foot of the list stays — it is where you go when you don't
 * know which section a thing belongs in, and it is the only one that can
 * invent a new category. This is the short version for when you *do* know,
 * because you are reading that section right now.
 *
 * It carries no category picker on purpose. The section is the answer, and a
 * select that can only have one value is a question not worth asking.
 */
export function InlineAddItem({
  category,
  existingItems,
  onAdd,
  onBump,
  onClose,
}: {
  category: ItemCategory;
  /** Whole, not labels — a repeat has to find the row it should increment. */
  existingItems: Item[];
  onAdd: (item: Item) => void;
  onBump: (item: Item) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Name the item you want to add.");
      return;
    }

    /* Same rule as the form at the foot of the list, and it has to be: asking
       for a second pair of socks should not depend on which box you typed
       into. A repeat adds one to the row that exists, wherever it lives, and
       says where that was. */
    const already = existingItems.find(
      (i) => i.label.toLowerCase() === trimmed.toLowerCase(),
    );
    if (already) {
      onBump(already);
      setNote(`${already.label} → ${already.qty + 1}, in ${already.category}.`);
      setLabel("");
      setError(undefined);
      return;
    }

    onAdd({
      id: crypto.randomUUID(),
      label: trimmed,
      qty: 1,
      category,
      source: "manual",
      packed: false,
    });
    setNote(`Added ${trimmed}.`);
    setLabel("");
    setError(undefined);
    /* Focus stays put so several things can go into one section in a row. */
    inputRef.current?.focus();
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="border-b border-rule bg-surface-raised px-3 py-3"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-48 flex-1">
          <Field label={`Add to ${category}`} error={error}>
            {(props) => (
              <TextInput
                {...props}
                ref={inputRef}
                value={label}
                placeholder="Laundry sheets"
                onChange={(e) => {
                  setLabel(e.target.value);
                  if (error) setError(undefined);
                  if (note) setNote(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                }}
              />
            )}
          </Field>
        </div>
        <span className="flex items-center gap-2 pt-7">
          <Button type="submit">Add</Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </span>
      </div>
      {note && (
        <p role="status" className="text-small text-success">
          {note}
        </p>
      )}
    </form>
  );
}
