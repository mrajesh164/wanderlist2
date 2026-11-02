"use client";

import type { ReactNode } from "react";

/**
 * One consistent frame for every block on a trip page.
 *
 * The page had grown four section headers in four styles — badges, a label
 * pair, a display heading, a bare rule — so even though each block was fine
 * on its own, the page read as scattered. This is the single rhythm: a rule,
 * a title, a muted line on the right, and a body that can be put away.
 *
 * `<details>` rather than a custom toggle, for the same reason as elsewhere:
 * keyboard operation and the open/closed state come free, and `<summary>` is
 * not one of the raw controls the component rule forbids.
 *
 * Everything is open by default. Collapsing is for the person who already
 * knows what is in a section, not a way to hide things from someone who
 * doesn't — a trip page that greets you folded shut is worse than a long one.
 */
export function TripSection({
  title,
  meta,
  note,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** Short right-hand context: a source, a system name, a count. */
  meta?: ReactNode;
  /** One line under the header, when the section needs explaining. */
  note?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group mt-6 border-t-2 border-ink">
      <summary className="cursor-pointer list-none pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="flex items-baseline gap-2 font-display text-[22px] font-semibold leading-tight text-ink">
            {/* Rotates on open. A character rather than an icon, because there
                is no icon package and there isn't going to be one. */}
            <span
              aria-hidden="true"
              className="text-muted transition-transform group-open:rotate-90"
            >
              ›
            </span>
            {title}
          </h2>
          {meta && <span className="font-sans text-label uppercase tracking-[0.14em] text-muted">{meta}</span>}
        </div>
      </summary>

      {note && <p className="mt-1 text-small text-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </details>
  );
}
