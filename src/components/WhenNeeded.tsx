"use client";

import { useState } from "react";
import { Chip, QuietAction } from "./Controls";
import { WHEN_TAGS, type WhenTag } from "@/lib/types";

/**
 * When a thing is needed — on every trip, or under particular conditions.
 *
 * Assignment 4 feedback asked for this twice over: weather conditions per
 * clothing item, and a split between what you always need and what you
 * sometimes need. The reason it earns its place is that the answers are
 * *used*: `buildPackingList` reads them, so saying "umbrella, when it rains"
 * once stops you re-adding it to every wet trip.
 *
 * Folded away by default. A row in a long inventory should read as one line;
 * five toggles on every row is the clutter the same feedback complained about
 * elsewhere.
 */
export function WhenNeeded({
  label,
  alwaysNeeded,
  whenTags,
  onChange,
}: {
  label: string;
  alwaysNeeded: boolean;
  whenTags: WhenTag[];
  onChange: (alwaysNeeded: boolean, whenTags: WhenTag[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const summary = alwaysNeeded
    ? "Always"
    : whenTags.length > 0
      ? WHEN_TAGS.filter((t) => whenTags.includes(t.tag))
          .map((t) => t.label.replace(/^When it's |^When it /, ""))
          .join(", ")
      : "Any trip";

  function toggle(tag: WhenTag) {
    const next = whenTags.includes(tag)
      ? whenTags.filter((t) => t !== tag)
      : [...whenTags, tag];
    /* Choosing a condition means it is not an always — the two answers are
       alternatives, and leaving both set would make the summary a lie. */
    onChange(false, next);
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <QuietAction
        onClick={() => setOpen((o) => !o)}
        label={`Set when you need ${label.toLowerCase()}`}
        className="opacity-100 underline decoration-rule-strong underline-offset-2 hover:text-ink"
      >
        {summary}
      </QuietAction>

      {open && (
        <span className="flex flex-wrap items-center gap-1.5 py-1">
          <Chip
            onClick={() => onChange(!alwaysNeeded, [])}
            label={`${label}: needed on every trip`}
          >
            <span className={alwaysNeeded ? "font-semibold text-ink" : ""}>
              Always
            </span>
          </Chip>
          {WHEN_TAGS.map((t) => (
            <Chip
              key={t.tag}
              onClick={() => toggle(t.tag)}
              label={`${label}: ${t.label.toLowerCase()}`}
            >
              <span
                className={
                  whenTags.includes(t.tag) ? "font-semibold text-ink" : ""
                }
              >
                {t.label}
              </span>
            </Chip>
          ))}
        </span>
      )}
    </span>
  );
}
