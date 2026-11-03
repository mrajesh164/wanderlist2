"use client";

/**
 * The smaller shared controls.
 *
 * These were each written inline at their one call site first, which is how a
 * component set quietly stops being one: the ± steppers carried their own copy
 * of the border and hover classes, the inventory toggle had another, the chips
 * a third. A Step 5 audit turned up eight hand-styled buttons across six files.
 * Anything that appears more than once, or that someone would reasonably reach
 * for again, belongs here.
 */

/* -------------------------------------------------------------------------
   Stepper — a quantity you can nudge
------------------------------------------------------------------------- */

const STEP_BUTTON =
  "size-6 border border-rule-strong bg-surface text-small leading-none " +
  "text-ink hover:bg-surface-raised disabled:opacity-40 " +
  "disabled:hover:bg-surface";

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  /** Used to build the labels: "One more pair of socks". */
  noun,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  noun: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`One fewer ${noun}`}
        className={STEP_BUTTON}
      >
        −
      </button>
      <span className="min-w-5 text-center font-sans text-small tabular-nums text-ink">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`One more ${noun}`}
        className={STEP_BUTTON}
      >
        +
      </button>
    </span>
  );
}

/* -------------------------------------------------------------------------
   QuietAction — a destructive or secondary affordance that stays out of the way

   Hidden until the row is hovered *or* the button takes keyboard focus, so it
   never becomes pointer-only.
------------------------------------------------------------------------- */

export function QuietAction({
  onClick,
  label,
  children,
  className = "",
}: {
  onClick: () => void;
  /** Full sentence for assistive tech: "Remove socks from this list". */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={
        "text-small text-muted opacity-0 transition-opacity hover:text-error " +
        `focus-visible:opacity-100 group-hover:opacity-100 ${className}`
      }
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------
   SegmentedControl — two or three mutually exclusive views
------------------------------------------------------------------------- */

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
  /** Names the group for assistive tech, e.g. "Sort the inventory". */
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex border border-rule-strong"
    >
      {options.map(([optionValue, optionLabel], i) => {
        const selected = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(optionValue)}
            className={`px-3 py-1.5 font-sans text-small ${
              i > 0 ? "border-l border-rule-strong" : ""
            } ${
              selected
                ? "bg-ink font-semibold text-surface"
                : "bg-surface text-muted hover:bg-surface-raised hover:text-ink"
            }`}
          >
            {optionLabel}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Chip — a small token, either static or clickable
------------------------------------------------------------------------- */

const CHIP_BASE =
  "flex items-center gap-2 border border-rule-strong px-2.5 py-1 text-small";

export function Chip({
  children,
  swatch,
  onClick,
  label,
}: {
  children: React.ReactNode;
  /** A category colour, shown as a small square. */
  swatch?: string;
  onClick?: () => void;
  label?: string;
}) {
  const body = (
    <>
      {swatch && (
        <span
          aria-hidden="true"
          className="inline-block size-2"
          style={{ backgroundColor: swatch }}
        />
      )}
      {children}
    </>
  );

  if (!onClick) {
    return (
      <span className={`${CHIP_BASE} bg-selected text-ink`}>{body}</span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`${CHIP_BASE} bg-surface text-ink hover:bg-selected`}
    >
      {body}
      <span aria-hidden="true" className="text-muted">
        +
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------
   SuggestionList — the type-ahead under the destination field
------------------------------------------------------------------------- */

export function SuggestionList<T>({
  items,
  getKey,
  onPick,
  children,
}: {
  items: T[];
  getKey: (item: T) => string;
  onPick: (item: T) => void;
  children: (item: T) => React.ReactNode;
}) {
  if (items.length === 0) return null;

  return (
    /* `data-suggestions` lets the field above tell "they left to pick one of
       these" from "they left the field" — see TripForm's blur handler. */
    <ul data-suggestions className="mt-1 border border-rule-strong bg-surface">
      {items.map((item) => (
        <li key={getKey(item)}>
          <button
            type="button"
            /* Keep focus in the input. Without this, mousedown blurs the
               field, the field decides nothing was picked and shows its
               error, and the click that picks the city arrives a moment
               later and clears it again — one frame of a wrong error. */
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(item)}
            className="block w-full px-3 py-1.5 text-left text-small text-ink hover:bg-selected"
          >
            {children(item)}
          </button>
        </li>
      ))}
    </ul>
  );
}
