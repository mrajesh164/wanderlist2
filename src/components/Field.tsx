"use client";

import { useId } from "react";

/**
 * One field: a real <label>, an optional hint, and an error that sits directly
 * under the control it belongs to.
 *
 * The children are a render function so the generated ids can't drift apart —
 * every control gets `id`, and `aria-describedby` wired to whichever of the
 * hint and the error are actually present. That makes it impossible to add a
 * field to this app without a label properly tied to it.
 *
 * Error copy is written as an instruction ("Enter a destination.") rather than
 * a diagnosis ("Invalid input."). That's a requirement, and it's enforced by
 * whoever writes the string — keep it in the imperative.
 */

export type ControlProps = {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean | undefined;
  "data-invalid": boolean | undefined;
};

/**
 * Move focus to the first field that failed validation.
 *
 * Call this after a failed submit. Without it the error text appears but focus
 * stays on <body>, so a keyboard or screen-reader user gets no signal that
 * anything went wrong and has to hunt the form for it — which is exactly what
 * the first-run check turned up.
 */
export function focusFirstError(form: HTMLFormElement | null): void {
  const invalid = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
  invalid?.focus();
}

type FieldProps = {
  label: string;
  /** Marked visibly, per the brief's "Aisle (optional)" example. */
  optional?: boolean;
  hint?: string;
  error?: string;
  /** Layout only — for sitting a field in a row beside another. */
  className?: string;
  children: (props: ControlProps) => React.ReactNode;
};

export function Field({
  label,
  className = "",
  optional = false,
  hint,
  error,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={`mb-6 ${className}`}>
      <label
        htmlFor={id}
        className="mb-1.5 block font-sans text-small font-semibold text-ink"
      >
        {label}
        {optional && (
          <span className="ml-1.5 font-normal text-muted">(optional)</span>
        )}
      </label>

      {hint && (
        <p id={hintId} className="mb-1.5 text-small text-muted">
          {hint}
        </p>
      )}

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "data-invalid": error ? true : undefined,
      })}

      {error && (
        /* An error is a rule, an icon and a tint — never an accent fill. */
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 flex items-start gap-2 border-l-2 border-error bg-selected px-2.5 py-1.5 text-small text-error"
        >
          <span aria-hidden="true" className="font-semibold">
            !
          </span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Controls. All share one frame so an input and a select look identical.
------------------------------------------------------------------------- */

const CONTROL =
  "w-full rounded-[2px] border border-rule-strong bg-surface px-3 py-2 " +
  "font-sans text-body text-ink placeholder:text-muted " +
  "data-[invalid=true]:border-error data-[invalid=true]:bg-selected";

export function TextInput({
  className = "",
  ...props
}: React.ComponentPropsWithRef<"input">) {
  return <input className={`${CONTROL} ${className}`} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    /* Native control, same frame as the input, per the design system. */
    <select className={`${CONTROL} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function TextArea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  /* Same frame as the input. This exists because AddKitForm had the CONTROL
     string copied out by hand — the sort of drift that makes a design system
     stop being one. */
  return <textarea className={`${CONTROL} ${className}`} {...props} />;
}

/* -------------------------------------------------------------------------
   A square checkbox. (Radios are round; checkboxes are not.)
------------------------------------------------------------------------- */

export function Checkbox({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={
        "checkbox size-[18px] shrink-0 cursor-pointer appearance-none rounded-[2px] " +
        "border border-rule-strong bg-surface " +
        `checked:border-ink checked:bg-ink ${className}`
      }
      {...props}
    />
  );
}
