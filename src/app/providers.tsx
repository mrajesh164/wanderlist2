"use client";

/**
 * The single source of truth for trips — now backed by Supabase.
 *
 * This provider lives in the root layout, which matters more than it looks:
 * with `cacheComponents` on, Next keeps recently visited routes mounted via
 * React <Activity> instead of unmounting them. If each route held its own copy
 * of the trips state, navigating back to a route would show you a stale copy.
 * One provider above the routes avoids that entirely.
 *
 * **Writes are optimistic.** Every mutation updates local state immediately and
 * sends the row afterwards, because packing is a stream of small ticks and
 * waiting for a round trip on each one would make the checklist feel broken. If
 * a write fails, `error` is set and the whole snapshot is refetched — so the
 * screen converges on what the database actually holds rather than quietly
 * drifting from it.
 *
 * The public API is unchanged from the localStorage version on purpose: ten
 * components consume `useTrips()`, and swapping the backend shouldn't touch any
 * of them.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useUser } from "@clerk/nextjs";
import { supabaseConfigError, useSupabase } from "@/lib/supabase";
import {
  deleteKitItem,
  deleteTrip,
  fetchSnapshot,
  insertKitItems,
  insertTrip,
  saveKitQty,
  saveKitWhen,
  saveTrip,
  type Snapshot,
} from "@/lib/trips-db";
import type { Item, ItemCategory, KitItem, Trip, WhenTag } from "@/lib/types";

/** One line of an inventory add: a label, and a count only if you gave one. */
export type KitAddition = { label: string; qty?: number };

/** The range the stepper can reach, applied anywhere a count is written. */
function clampQty(qty: number): number {
  return Math.max(1, Math.min(99, Math.round(qty)));
}

const EMPTY: Snapshot = { trips: [], kit: [] };

type TripsContextValue = {
  trips: Trip[];
  /** False until the first load resolves; lets the UI hold a quiet placeholder. */
  ready: boolean;
  /** Set when a write or load failed. Null when everything is in step. */
  error: string | null;
  addTrip: (trip: Trip) => void;
  updateTrip: (id: string, patch: (trip: Trip) => Trip) => void;
  removeTrip: (id: string) => void;
  toggleItem: (tripId: string, itemId: string) => void;
  setItemQty: (tripId: string, itemId: string, qty: number) => void;
  /** Adds an item and remembers it for the next run of this trip. */
  addItem: (tripId: string, item: Item) => void;
  /** Removes an item and remembers not to suggest it next time. */
  removeItem: (tripId: string, itemId: string) => void;
  /** Things you own, added to your inventory directly. */
  kit: KitItem[];
  addKitItems: (entries: KitAddition[], category: string) => void;
  /**
   * Record how many of something you own. Creates the inventory entry when
   * there isn't one, so a row derived purely from trip history can be counted
   * without a separate "this is mine" step.
   */
  setKitQty: (label: string, category: ItemCategory, qty: number) => void;
  /** When a thing is needed: on every trip, and/or under given conditions. */
  setKitWhen: (
    label: string,
    category: ItemCategory,
    alwaysNeeded: boolean,
    whenTags: WhenTag[],
  ) => void;
  removeKitItem: (id: string) => void;
  resetEverything: () => void;
};

const TripsContext = createContext<TripsContextValue | null>(null);

export function TripsProvider({ children }: { children: React.ReactNode }) {
  const supabase = useSupabase();
  const { user, isLoaded: userLoaded } = useUser();
  const userId = user?.id ?? null;

  /**
   * The snapshot is stamped with whose it is.
   *
   * Signing out and back in does **not** remount this provider: Clerk performs
   * a soft client-side navigation and a `router.refresh()`, which re-fetches
   * server components without unmounting client ones, and this provider sits
   * in the root layout with no key. So without the stamp, rows fetched for one
   * account stay in state across an identity change, and the next person to
   * sign in on the same browser is shown the previous person's trips until
   * their own fetch resolves — names, destinations and pack counts included.
   *
   * It has to be checked at render rather than cleared in an effect: effects
   * run after paint, so a cleanup would still let one frame of the wrong
   * account's data reach the screen.
   */
  const [snapshot, setSnapshot] = useState<{
    uid: string | null;
    data: Snapshot;
  }>({ uid: null, data: EMPTY });
  /** True once a fetch has resolved. Only ever set after an await. */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(supabaseConfigError);

  /** Do the rows in hand belong to whoever is signed in right now? */
  const mine = userId !== null && snapshot.uid === userId;

  /* Derived rather than stored. Signed out there is nothing to wait for, so
     "ready" is immediate — and deriving it means the effect below never has to
     setState synchronously, which React rightly objects to. Across an identity
     change `mine` is false, so this goes back to false and the routes show
     their placeholders rather than somebody else's list. */
  const ready = userLoaded && (!supabase || (loaded && mine));

  /* Mutations need the current snapshot to compute the next one *and* the
     resulting value to send to the database. A functional setState gives the
     first but not the second, so the snapshot is mirrored in a ref and every
     change goes through `apply`. */
  const stateRef = useRef<Snapshot>(EMPTY);

  /* Stamped here too, so an optimistic write can never carry one account's
     rows into another's. */
  const apply = useCallback(
    (next: Snapshot) => {
      stateRef.current = next;
      setSnapshot({ uid: userId, data: next });
    },
    [userId],
  );

  /** Refetch after a refused write. Not used for the initial load — see below. */
  const reload = useCallback(async () => {
    if (!supabase) return;
    try {
      const snapshot = await fetchSnapshot(supabase);
      apply(snapshot);
      setError(supabaseConfigError);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoaded(true);
    }
  }, [supabase, apply]);

  /**
   * The initial load, written as callbacks rather than `await` on purpose.
   *
   * State is set inside `.then`/`.catch`, which is what React wants from an
   * effect — synchronous setState in the body causes cascading renders. The
   * `active` flag is the part that matters though: signing out and back in
   * fires this twice, and without the guard a slow first fetch could land
   * after a fast second one and show the previous account's trips.
   */
  useEffect(() => {
    if (!supabase) return;
    let active = true;

    fetchSnapshot(supabase)
      .then((snapshot) => {
        if (!active) return;
        apply(snapshot);
        setError(supabaseConfigError);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [supabase, apply]);

  /* Signed out shows nothing of anyone's, whatever happens to be left in
     state — belt and braces alongside the middleware, and it means signing out
     empties the screen without an effect to clear it. */
  /* Memoised because the `[]` branch would otherwise be a fresh array on every
     render, busting the context value's memo and re-rendering every consumer. */
  const trips = useMemo(
    () => (supabase && mine ? snapshot.data.trips : []),
    [supabase, mine, snapshot.data.trips],
  );
  const kit = useMemo(
    () => (supabase && mine ? snapshot.data.kit : []),
    [supabase, mine, snapshot.data.kit],
  );

  /**
   * Hand the answer to the CSS gate in globals.css, which decides whether home
   * shows its first-visit face or its returning one. `<html>` ships as
   * "loading" and both faces stay hidden until this runs — a frame of nothing
   * beats a frame of the wrong screen for someone with six trips.
   */
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.hasTrips = trips.length > 0 ? "yes" : "no";
  }, [ready, trips.length]);

  /**
   * Send a change, and reconcile if it's refused.
   *
   * A rejected write usually means an RLS policy said no, which in this app
   * would mean a genuine bug rather than a transient failure — so refetching
   * is the honest response: show what the database really has.
   */
  const write = useCallback(
    async (fn: (db: SupabaseClient, uid: string) => Promise<void>) => {
      /* Never silently. This returned bare `return` and that cost an hour: a
         mutation fired before the client existed was dropped without a trace,
         the optimistic row was then wiped by the in-flight initial fetch, and
         the person was left looking at "That trip isn't here" with nothing
         saved. Callers are gated on `ready` so this should be unreachable —
         which is exactly why it must say so if it ever isn't. */
      if (!supabase || !userId) {
        setError("Not signed in yet — that change wasn't saved. Try again.");
        return;
      }
      try {
        await fn(supabase, userId);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        void reload();
      }
    },
    [supabase, userId, reload],
  );

  const addTrip = useCallback(
    (trip: Trip) => {
      const prev = stateRef.current;
      apply({ ...prev, trips: [...prev.trips, trip] });
      void write((db, uid) => insertTrip(db, trip, uid));
    },
    [apply, write],
  );

  const updateTrip = useCallback(
    (id: string, patch: (trip: Trip) => Trip) => {
      const prev = stateRef.current;
      const target = prev.trips.find((t) => t.id === id);
      if (!target) return;
      const patched = patch(target);
      apply({
        ...prev,
        trips: prev.trips.map((t) => (t.id === id ? patched : t)),
      });
      void write((db, uid) => saveTrip(db, patched, uid));
    },
    [apply, write],
  );

  const removeTrip = useCallback(
    (id: string) => {
      const prev = stateRef.current;
      apply({ ...prev, trips: prev.trips.filter((t) => t.id !== id) });
      void write((db) => deleteTrip(db, id));
    },
    [apply, write],
  );

  const toggleItem = useCallback(
    (tripId: string, itemId: string) => {
      updateTrip(tripId, (trip) => ({
        ...trip,
        items: trip.items.map((i) =>
          i.id === itemId ? { ...i, packed: !i.packed } : i,
        ),
      }));
    },
    [updateTrip],
  );

  const setItemQty = useCallback(
    (tripId: string, itemId: string, qty: number) => {
      const clamped = clampQty(qty);
      updateTrip(tripId, (trip) => ({
        ...trip,
        items: trip.items.map((i) =>
          i.id === itemId ? { ...i, qty: clamped } : i,
        ),
      }));
    },
    [updateTrip],
  );

  /**
   * Adding by hand does three things at once, because they're all the same act:
   * the item joins this trip, it joins `learned.add` so the next run of the trip
   * starts with it already there, and it joins your inventory — if you packed
   * it, you own it, and having to list it a second time would be busywork.
   */
  const addItem = useCallback(
    (tripId: string, item: Item) => {
      const prev = stateRef.current;
      const key = item.label.toLowerCase();
      const target = prev.trips.find((t) => t.id === tripId);
      if (!target) return;

      const patched: Trip = {
        ...target,
        items: [...target.items, item],
        learned: {
          // Previously dropped? They've changed their mind — un-drop it.
          drop: target.learned.drop.filter((d) => d.toLowerCase() !== key),
          add: target.learned.add.some((a) => a.toLowerCase() === key)
            ? target.learned.add
            : [...target.learned.add, item.label],
        },
      };

      const alreadyOwned = prev.kit.some((k) => k.label.toLowerCase() === key);
      const fresh: KitItem | null = alreadyOwned
        ? null
        : {
            id: crypto.randomUUID(),
            label: item.label,
            category: item.category,
            /* Deliberately no qty. This add is a side effect of packing, not
               a statement about how many you own — nobody was shown a number
               to accept. The inventory infers one from trips instead, and the
               row stays out of the shortfall warnings until it has evidence.
               Don't "fix" this to 1; see resolveQty in lib/inventory.ts. */
            addedAt: new Date().toISOString(),
          };

      apply({
        trips: prev.trips.map((t) => (t.id === tripId ? patched : t)),
        kit: fresh ? [...prev.kit, fresh] : prev.kit,
      });

      void write(async (db, uid) => {
        await saveTrip(db, patched, uid);
        if (fresh) await insertKitItems(db, [fresh], uid);
      });
    },
    [apply, write],
  );

  /**
   * Removing is the mirror image. A suggested item goes onto `learned.drop` so
   * it stops being offered; a hand-added one simply comes back off `learned.add`
   * rather than being recorded as a rejection of a suggestion we never made.
   */
  const removeItem = useCallback(
    (tripId: string, itemId: string) => {
      updateTrip(tripId, (trip) => {
        const item = trip.items.find((i) => i.id === itemId);
        if (!item) return trip;
        const key = item.label.toLowerCase();
        const wasHandAdded = trip.learned.add.some(
          (a) => a.toLowerCase() === key,
        );
        return {
          ...trip,
          items: trip.items.filter((i) => i.id !== itemId),
          learned: {
            add: trip.learned.add.filter((a) => a.toLowerCase() !== key),
            drop:
              wasHandAdded ||
              trip.learned.drop.some((d) => d.toLowerCase() === key)
                ? trip.learned.drop
                : [...trip.learned.drop, item.label],
          },
        };
      });
    },
    [updateTrip],
  );

  /**
   * Add several at once: people list what they own in one go rather than one
   * field at a time. Anything already in the inventory is skipped silently
   * rather than erroring — pasting an overlapping list is normal, and the form
   * routes genuine duplicates to setKitQty so they add up instead.
   */
  const addKitItems = useCallback(
    (entries: KitAddition[], category: string) => {
      const prev = stateRef.current;
      const existing = new Set(prev.kit.map((k) => k.label.toLowerCase()));
      const additions: KitItem[] = [];

      for (const entry of entries) {
        const trimmed = entry.label.trim();
        if (!trimmed || existing.has(trimmed.toLowerCase())) continue;
        existing.add(trimmed.toLowerCase());
        additions.push({
          id: crypto.randomUUID(),
          label: trimmed,
          category: category.trim() || "Extras",
          /* Anything put through the inventory form starts at a real 1 rather
             than an absent one. Someone who typed a thing in saw that number
             and let it stand, which is a claim — unlike a row the app worked
             out from trip history, where the 1 was nobody's idea. */
          qty: clampQty(entry.qty ?? 1),
          addedAt: new Date().toISOString(),
        });
      }

      if (additions.length === 0) return;
      apply({ ...prev, kit: [...prev.kit, ...additions] });
      void write((db, uid) => insertKitItems(db, additions, uid));
    },
    [apply, write],
  );

  /**
   * Set how many you own.
   *
   * The interesting case is a label with no inventory entry at all — a row the
   * inventory derived from trip history. Touching its stepper is what turns an
   * inference into a fact, so this creates the entry rather than refusing. That
   * single gesture is the whole "claim this item" flow.
   */
  /**
   * Record when an item is needed.
   *
   * Creates the KitItem when the label only exists as a derived row, exactly
   * as setKitQty does — saying "I need this when it rains" is itself the claim
   * that it is yours, so there is no separate step.
   */
  const setKitWhen = useCallback(
    (
      label: string,
      category: ItemCategory,
      alwaysNeeded: boolean,
      whenTags: WhenTag[],
    ) => {
      const prev = stateRef.current;
      const key = label.toLowerCase();
      const known = prev.kit.find((k) => k.label.toLowerCase() === key);

      if (known) {
        apply({
          ...prev,
          kit: prev.kit.map((k) =>
            k.label.toLowerCase() === key
              ? { ...k, alwaysNeeded, whenTags }
              : k,
          ),
        });
        void write((db) => saveKitWhen(db, known.id, alwaysNeeded, whenTags));
        return;
      }

      const fresh: KitItem = {
        id: crypto.randomUUID(),
        label,
        category,
        alwaysNeeded,
        whenTags,
        addedAt: new Date().toISOString(),
      };
      apply({ ...prev, kit: [...prev.kit, fresh] });
      void write((db, uid) => insertKitItems(db, [fresh], uid));
    },
    [apply, write],
  );

  const setKitQty = useCallback(
    (label: string, category: ItemCategory, qty: number) => {
      const clamped = clampQty(qty);
      const prev = stateRef.current;
      const key = label.toLowerCase();
      const known = prev.kit.find((k) => k.label.toLowerCase() === key);

      if (known) {
        apply({
          ...prev,
          kit: prev.kit.map((k) =>
            k.label.toLowerCase() === key ? { ...k, qty: clamped } : k,
          ),
        });
        void write((db) => saveKitQty(db, known.id, clamped));
        return;
      }

      const fresh: KitItem = {
        id: crypto.randomUUID(),
        label,
        category,
        qty: clamped,
        addedAt: new Date().toISOString(),
      };
      apply({ ...prev, kit: [...prev.kit, fresh] });
      void write((db, uid) => insertKitItems(db, [fresh], uid));
    },
    [apply, write],
  );

  const removeKitItem = useCallback(
    (id: string) => {
      const prev = stateRef.current;
      apply({ ...prev, kit: prev.kit.filter((k) => k.id !== id) });
      void write((db) => deleteKitItem(db, id));
    },
    [apply, write],
  );

  /**
   * Clear everything of yours. Powers "Reset to first visit", which exists
   * because the onboarding is otherwise unreachable the moment it succeeds.
   * It now deletes rows rather than clearing a key, so it really is a reset
   * and not just a local forget.
   */
  const resetEverything = useCallback(() => {
    const prev = stateRef.current;
    apply(EMPTY);
    void write(async (db) => {
      await Promise.all(prev.trips.map((t) => deleteTrip(db, t.id)));
      await Promise.all(prev.kit.map((k) => deleteKitItem(db, k.id)));
    });
  }, [apply, write]);

  const value = useMemo<TripsContextValue>(
    () => ({
      trips,
      ready,
      error,
      addTrip,
      updateTrip,
      removeTrip,
      toggleItem,
      setItemQty,
      addItem,
      removeItem,
      kit,
      addKitItems,
      setKitQty,
      setKitWhen,
      removeKitItem,
      resetEverything,
    }),
    [
      trips,
      kit,
      ready,
      error,
      addTrip,
      updateTrip,
      removeTrip,
      toggleItem,
      setItemQty,
      addItem,
      removeItem,
      addKitItems,
      setKitQty,
      setKitWhen,
      removeKitItem,
      resetEverything,
    ],
  );

  return <TripsContext value={value}>{children}</TripsContext>;
}

export function useTrips(): TripsContextValue {
  const ctx = useContext(TripsContext);
  if (!ctx) {
    throw new Error("useTrips must be used inside <TripsProvider>");
  }
  return ctx;
}

/** Convenience for the trip routes. */
export function useTrip(id: string): Trip | undefined {
  const { trips } = useTrips();
  return trips.find((t) => t.id === id);
}
