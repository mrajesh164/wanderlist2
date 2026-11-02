<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Wanderlist

Packing lists for your favorite destinations. You keep the trips you take again in one place
— "Thanksgiving at my parents'", "Ann Arbor for a game weekend", "Lisbon in March"
— and each time one comes around, the list is already built, already corrected by
the last time you took it, and already adjusted for how long you're going and what
the weather does there that month.

Course: Design, Build, Ship · MPCS 51238 · **Assignment 5 (Live Data System)**.
Due Tuesday, November 3 2026, 5:30 PM. This repository starts from the finished
Assignment 4 app — 80 commits of it — and adds a worker, live bikeshare data and
a page that updates on its own. The work happens on the `live-data` branch.

Assignment 4's own notes are kept below rather than rewritten, because the
reasoning behind the data model, the Clerk constraints and the design system all
still hold. Where a section says "Assignment 4", read it as *how the app that this
one extends came to be*. The new work is in **Assignment 5 — the live layer**.

## The three flows

The assignment is organized around three flows. Every design decision should serve one.

**1. First visit** — nothing in storage. There is nothing to show, so instead of an empty
screen it offers three ready-made trips to adopt ("A weekend at home", "A week
somewhere warm", "Three days for a conference"). One tap produces a real trip with a real
packing list. The person learns what the tool is by using it, not
by reading a tour.

**2. The core task** — written as one sentence:

> I add a trip → it builds a packing list from the dates and the destination → I check things off as I pack → I come back next time and it's already corrected from last trip.

**3. Coming back** — three reasons, on three clocks:
- *Mid-pack:* packing happens over several evenings, so a part-packed list is a
  standing invitation to come back and finish it.
- *Before the trip:* home and Upcoming both lead with the next departure and what's still unpacked ("Lisbon, in 3 days — 7 items left").
- *After the trip:* a short review marks what you never used and what you wished
  you'd brought. Those corrections are applied the next time you pack that trip.
  The list measurably improves each time you return.

## Shape of the app

Four tabs in the masthead, which is what gives the tool a legible purpose. New trip leads
because starting one is what people arrive to do; the rest are views onto trips that
already exist.

| Tab | Route | What it is |
|---|---|---|
| — | `/` | Home, with two faces. **A true first visit lands here and the onboarding *is* this page** — three ready-made trips or your own, one tap to a real list. Returning, it says "Welcome Back" and leads with the next departure. |
| New trip | `/trips/new` | The form. Also serves `?from=<id>` to repeat a finished trip with its corrections applied. |
| Upcoming | `/trips` | Upcoming trips only, soonest first. Starters on a true first visit. |
| Previous | `/previous` | Finished trips: what was packed, what each taught the next list, and "Pack this again". Lives at `/previous`, not `/trips/previous`, so it can't collide with a trip id. |
| Inventory | `/inventory` | Things you list yourself (`kit` in storage) merged with everything trips reveal. Every row carries a quantity and a stepper to set it. Sorts by Packed most, or filters to Never used. Also lists what you took per finished trip. |

A trip (`/trips/[id]`) and its review belong to the Upcoming tab, since that's
where you came from.

**The first visit lives in `components/StarterTrips.tsx`**, rendered by both `/`
and `/trips` so neither entry point can dead-end. The `data-when` CSS gate (see
`globals.css`) applies to home. `components/ResetFirstVisit.tsx` in the footer
exists because otherwise the onboarding becomes unreachable the moment it
succeeds — there's no other way to see it again.

**The worked example is gone.** Assignment 3 carried a
`components/WorkedExample.tsx` — a trip already packed twice with its
corrections shown inline — on the argument that the correction loop takes two
trips to demonstrate and a first visit can't otherwise show it. It was removed
in Assignment 4 as a product decision, and the removal took `lib/example.ts`,
the `isExample` flag and its badges with it. Don't reintroduce any of them
without asking: a boolean nothing writes is a question waiting to be asked in a
code review.

It also had the bug the starter cards had — `addTrip` then navigate, which
signed out meant arriving after sign-up at a trip that was never saved. If
anything like it comes back, it has to be a link, not a mutation. See
**Signed-out visitors** below.

**Signed-out visitors can pick a starter without losing it.** `adopt()` writes a
row, so signed out the cards link to `/trips/new?starter=<key>` instead and the
form opens pre-filled from `lib/starters.ts`. The middleware carries the query
through the sign-in redirect, so the trip they chose is waiting rather than
lost. Signed in, a card still builds the list on the spot. The gate is
`isSignedIn === true` so the moment before Clerk resolves takes the link, which
works either way.

**Adding an item does three things at once** (`addItem` in `providers.tsx`): it
joins the trip, joins `learned.add` so the next run of that trip starts with it,
and joins your inventory. If you packed it, you own it. The add form can also
pull straight *from* the inventory, which is what keeps that page from being a
read-only report.

**Inventory is mostly derived.** `src/lib/inventory.ts` aggregates `trip.items`
plus `trip.learned` across all trips, then merges in `state.kit` — the things
someone listed directly. Keep that split: trips remain the source of truth for
what has been *packed*, and `kit` only adds what hasn't been packed yet.

**Every inventory row has a quantity, and they're not equally trustworthy.**
`KitEntry.qtySource` says which kind a number is, and `resolveQty` picks it in
this order:

| Source | Where the number comes from | Trust |
| --- | --- | --- |
| `counted` | `KitItem.qty` — the **How many** field, the row's stepper, or the 1 both default to | True |
| `inferred` | `packedMax`, the most ever ticked off a list at once | A floor |
| `assumed` | `1`, because it's been on a list but never ticked | None |

**The number is `max(counted, packedMax)`.** You cannot own fewer of something
than you have packed at once, so evidence raises a claim and never the reverse.
This is what makes a default of 1 safe: accept the 1 on "Socks", tick
"Socks × 6" off a list, and the row reads 6 rather than holding a stale number.
Storage still says 1 — the max is computed on read, so nothing is rewritten
behind the user's back.

**`KitItem.qty` is optional, and the two cases are not the same claim:**

- Added through the **inventory form** → a real `1`. They saw that number and
  let it stand, so it counts and it may warn.
- Added as a **side effect of packing** (`addItem`, "if you packed it, you own
  it") → left undefined. Nobody was shown a quantity to accept. Don't "fix"
  this to 1; it would turn a side effect into a claim and warn on rows the
  person never counted.

Two more things depend on the distinction:

- `setKitQty` **creates** the `KitItem` when a label only exists as a derived
  row. Nudging a stepper is the whole "this is mine" flow; there is no separate
  claim step.
- `shortfall()` ignores `assumed` numbers. Everything uncounted sits at 1, so
  without that guard a new person's first trip would warn on every row that
  asks for more than one. Only `counted` and `inferred` may speak.

The inventory stepper's `min` is `packedMax`, so it can't be set below the
floor — `resolveQty` would only put it back, which reads as a bug.

`AddKitForm`'s **How many** field sets the count for the whole submission, as
the category does, and resets to 1 after each add — the category persists
because people file several things into one place in a row, but a 2 carried
into the next add would quietly claim two of whatever comes next.

`parseEntries` still understands a trailing `x3` and a line that names its own
count overrides the field. It isn't advertised anywhere; it stays because
pasting a list that already carries counts is a real thing to do, and the
alternative is an item named "Wool socks x2".

Listing something already in the inventory **adds up** rather than erroring. With
**How many** at 1 that means one more than the row shows; above 1 it's taken as
the count. The old "already in your inventory" error was the wrong answer to a
reasonable request (see the Assignment 3 feedback: owning two t-shirts was
unsayable).

**`AddItemForm` now does the same thing, and this was fixed late.** Typing
something already on a checklist used to raise "T Shirt is already on this
list." — the identical wrong answer, left behind when the inventory form was
fixed. It now adds one to the row that exists and reports
`Socks → 7, in Clothing`; the category picker is ignored for a repeat, so the
row keeps its section and nothing moves under the person. Naming the section is
half the fix: the refusal never said *where* the row already was, which on a
twenty-item list across seven sections is a search. `existingItems` is passed
whole rather than as labels precisely so the form can reach the row it needs to
increment. If a third form ever grows an "already there" case, it gets this
treatment too, not an error.

**Clothing counts stop at ten days, and the trip page says so.**
`LAUNDRY_CAP_DAYS` in `suggestions.ts` caps the duration-driven quantities —
underwear and socks at `capped + 1`, tops at `capped` — so a ten-day trip and a
three-week trip both ask for eleven pairs of socks. The rule is right; past that
you do laundry rather than carry more. It was also invisible, which made it
*look* like a bug: move a long trip's dates and "Trousers 4" becomes 5 while
"Underwear 11" doesn't move. One muted line under the progress bar now states it,
shown only when `days > LAUNDRY_CAP_DAYS`. Keep the constant and that sentence
wired together, and don't answer this with a per-row note — those were tried and
removed, because the same sentence repeated down every row said nothing the
header hadn't said better.

**One provenance badge on an inventory row, not two.** "Yours" and "Asked for"
both answered *did a person put this here, or did the generator?* — and on a page
titled "Your Inventory", "Yours" barely said anything. They are now a single
**Added by you**, shown for `owned || yourOwn || requested`. The flags stay
separate in `inventory.ts` because `owned` also gates the remove control; it is
only the display that merged. The remaining badges are about usefulness —
**Retired**, **Never used** — which is a different axis and reads clearly beside
it.

**Categories are open.** `ItemCategory` is a plain `string`; `KNOWN_CATEGORIES`
holds the seven defaults and `categoriesPresent()` orders known-then-custom. Use
`styleFor(category)` from `components/categoryStyle.ts` rather than indexing the
map, so an invented category still gets a colour.

## Pictures

`src/lib/photos.ts` holds one Wikimedia CDN thumbnail per destination slug. Those
URLs were resolved once by hand from Wikipedia's page-summary endpoint and each
verified to return 200; **the running app never calls an API**. Requesting widths
above the stored thumbnail returns 400, so don't rewrite the `NNNpx-` segment.

`DestinationArt` falls back to a generated SVG poster when there's no photo for a
destination, or when the image fails to load. The poster is drawn *from the
climate data* — sun height, palette and rain density all come from the month's
conditions — so an unknown destination still gets a picture that means something.

## The day strip

The visible half of the API, and the part most likely to be "improved" by
someone who doesn't know why it looks like this. Four files:
`lib/use-climate.ts` fetches, `lib/trip-days.ts` turns a date range into days,
`components/ConditionsNote.tsx` owns the four states and the one-line summary,
and `components/ConditionsStrip.tsx` draws the cells.

It replaced a sentence. "Cold, 31–44°F, some rain" is true of December in New
York and says nothing about whether to pack for the 10th differently from the
17th; the strip shows the shape of the actual dates, which is what you pack
from. The sentence survives as a one-line summary above it, because the band
and wetness it names are what the list was generated from.

Rules worth keeping:

- **Three registers in a cell, and size is what names them.** Weekday and date
  on one line in label type (uppercase, letterspaced — the one style in Café
  Terrace that unmistakably isn't a measurement), then the glyph, then the high
  in body semibold beside the low in label muted. An earlier version stacked a
  bare "10" above "46" above "34" in one size, which read as three numbers with
  no way to tell which was a date. Labelling them HI and LO is the obvious fix
  and the wrong one: four characters of chrome per cell to say what a size step
  already says.
- **Snow is judged on the mean of high and low**, not the low alone.
  `lowC <= 0` painted five snowflakes across a mid-December week in New York,
  where lows sit a degree below freezing and highs are 6–8 °C, so precipitation
  almost always arrives as rain.
- **Thresholds stay coarse.** The underlying figure is "4 of the last 15
  December 10ths were wet"; finer gradations than wet / unsettled / dry would be
  false precision.
- **Pigments, not a weather app's palette.** `WEATHER_STYLE` holds one hue and
  one faint tint per kind of day, in the same spirit as `categoryStyle.ts` and
  kept well away from the accent. Nine saturated cells in a row would be fruit
  salad.
- **Rows wrap; they don't scroll.** Balanced rather than filled — nine days go
  5 + 4, not 7 + 2 — with seven a ceiling (four on narrow screens). A strip you
  have to drag hides the days furthest out, which are the ones you're least sure
  how to pack for. The grid draws its top and left edge and every cell draws its
  own right and bottom, so the outer rule is never doubled and a part-filled last
  row closes itself off.
- **The glyphs are hand-written SVG paths**, because there is no icon package
  and there isn't going to be one.

## Data model

Three tables. Two hold one person's data and are fenced by row-level security;
one is shared reference data nobody owns. Read this before writing a migration.

**Clerk user ids are strings, not UUIDs** (`user_2abc...`), so `user_id` is `text`.
This is the single most likely thing to get wrong: with Supabase third-party auth,
`auth.uid()` expects a Supabase UUID and will **not** work here. Every policy
compares against the JWT's subject claim instead:

```sql
(auth.jwt() ->> 'sub') = user_id
```

### trips

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` pk, `gen_random_uuid()` | replaces `crypto.randomUUID()` |
| `user_id` | `text not null` | Clerk `sub` |
| `name` | `text not null` | "Thanksgiving at my parents'" |
| `destination` | `text not null` | free text, shown on the board |
| `climate_slug` | `text` | set when the destination matched the table |
| `manual_band` / `manual_wetness` | `text` | set when it didn't |
| `start_date` / `end_date` | `date not null` | were `"YYYY-MM-DD"` strings |
| `items` | `jsonb not null default '[]'` | the checklist — see below |
| `learned` | `jsonb not null default '{"drop":[],"add":[]}'` | corrections carried forward |
| `review` | `jsonb` | `neverUsed`, `wishedFor`, `reviewedAt` |
| `is_example` | `boolean not null default false` | **vestigial** — see below |
| `completed_at` | `timestamptz` | set when the trip is finished |
| `created_at` | `timestamptz not null default now()` | |

**`is_example` is vestigial and deliberately left alone.** It flagged the one
trip that was a demonstration rather than a real one, so it could be badged
wherever it appeared. That feature was removed in Assignment 4, and the column
stayed: nothing writes it, every row holds the default `false`, and dropping a
column is a destructive migration with no benefit beyond tidiness. Don't write
to it, don't read it, and don't let its presence imply the example is coming
back.

**Items stay as `jsonb` rather than becoming a fourth table.** The checklist is
always read and written whole: no query filters, sorts or joins on a single item,
and the inventory already aggregates them in JS (`buildInventory`). One row per
trip also means one RLS check per trip instead of per item. The costs, accepted
knowingly: no per-item access control (items are only ever reached through their
trip, so there's nothing to protect separately), and no SQL aggregation across
items. If a query ever needs to ask "which trips contain a sun hat", revisit this.

### kit_items

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` pk, `gen_random_uuid()` | |
| `user_id` | `text not null` | Clerk `sub` |
| `label` | `text not null` | |
| `category` | `text not null` | open-ended; see **Categories are open** |
| `qty` | `integer` | **nullable on purpose** |
| `added_at` | `timestamptz not null default now()` | |

Add `unique (user_id, lower(label))`. `buildInventory` keys rows by lowercased
label and assumes one row per label; Assignment 3 enforced that only in app code,
and a constraint makes it real.

`qty` being nullable is load-bearing, not laziness — null means nobody ever said
how many, which the inventory treats differently from a number someone chose. See
the quantity rules above; **do not add `default 1`.**

### climate_cache

Shared, derived, owned by nobody. Keyed by coordinates rounded to 0.1° and the
month, holding the averaged normals plus how many years went into them and when
it was fetched. No `user_id`.

It exists because the free weather tier rate-limits per IP, and because normals
for March in Lisbon are identical for every user on the planet — so one fetch
should serve everybody. That is also the answer to "where do you call the API and
why there": on the server, because the result is shared and caching it is the
whole point.

Measured, not assumed: a cold lookup is 15 sequential Open-Meteo requests at
about 5.3s; the same lookup served from this table takes 741ms. Open-Meteo
returned 429 after roughly ten calls from one shared IP, and their terms warn
that platforms like Vercel are throttled early, so without the cache the second
visitor to look up a city would be refused.

### Row-level security

Enable RLS on all three. For `trips` and `kit_items`, write all four policies —
select, insert, update, delete — each `using ((auth.jwt() ->> 'sub') = user_id)`,
and **insert and update also need `with check` on the same expression**. Without
`with check`, `using` alone lets someone write a row stamped with another
person's `user_id`. That omission is exactly what `/security-review` should catch,
so don't make it by accident.

`climate_cache` is the deliberate contrast: readable by any authenticated user,
writable by none. Only the server, holding the service role, fills it — see
`lib/supabase-admin.ts`, which is the single place that key is used and carries
`import "server-only"` so a client import fails the build rather than shipping
it. Two tables fenced per-user and one shared read-only table is a much easier
thing to explain than three identical policies.

**This was briefly built the other way, and `/security-review` caught it.** The
first version let any signed-in user insert, on the reasoning that a
service-role key in the environment was the worse risk. It wasn't: a check
constraint bounding the values didn't help, because a plausible-but-wrong row
(Lisbon in March at −20 °C, with an attacker-chosen label) still passed, and
with no update or delete policy it would have stayed. Writes are now refused by
an explicit `with check (false)` rather than a missing policy, so the refusal is
visible to anyone reading `pg_policies` instead of looking like an oversight.

### What the port broke

Assignment 3's state layer did not survive. These needed designing rather than
translating, and all four are **done** — recorded because the reasoning is
easier to lose than the code:

- **`HAS_TRIPS_SCRIPT` and `data-has-trips` died.** Replaced by the three-state
  gate described under *Stack notes*. The client cannot know which of signed
  out / signed in empty / signed in with trips applies before paint, so it
  admits that rather than guessing.
- **`readState` / `writeState` are gone** with `STORAGE_KEY` and
  `LEGACY_STORAGE_KEY`. Writes are optimistic — a round trip per checkbox tick
  would make packing feel broken — and a refused write sets `error` and
  refetches so the screen converges on the database rather than drifting.
- **Ids stay client-generated**, which is the one place the plan changed: it
  keeps `addTrip` synchronous for callers and lets an optimistic row carry its
  final id instead of swapping a placeholder when the insert returns.
- **Seeding the worked example** was the fourth, and it was **answered by
  deleting the feature** rather than by building it. The plan was to move the
  seed from first paint to first sign-in, server-side; instead the example went
  (see **The worked example is gone** above), which removed the question. A
  brand-new account therefore sees the starter trips and no worked example, and
  the correction loop is explained in words rather than demonstrated. That is a
  real cost, accepted knowingly: it was a fourth thing competing for the first
  screen, and signed out it walked people into a trip that had never been
  saved.

## Assignment 5 — the live layer

Assignment 5 adds a worker that polls a live source every few seconds and a page
that updates on its own. This section is the plan, **written before any code**,
which is what step 3 of the brief asks for. Read it before writing a migration or
the worker.

### The source, and why this one

**Bikeshare station availability, over GBFS.** Picked over weather (normals don't
change), live scores and earthquakes for one reason that should be stated plainly:

> **Ambient data beats episodic data.** Anything tied to one person's *trip* —
> their flight, their game — only moves while that trip is happening, and will be
> a still photograph at 5:30 on a Tuesday when someone grades it. Bikes come and
> go in Chicago at 2am whether or not anybody is travelling.

Three things were measured before committing, not assumed:

| | |
| --- | --- |
| Stations in the Chicago feed | 2,078 |
| Changed between two calls 120s apart | **72 — 3.5%** |
| Feed's advertised `ttl` | 60 seconds |

That 3.5% is the whole argument for the upsert: **the worker writes 72 rows, not
2,078**, and `worker_runs` records the number so the claim is checkable rather
than rhetorical.

**GBFS is a standard, not one city.** Divvy's auto-discovery document resolves to
`https://gbfs.lyft.com/gbfs/1.1/chi/en/…` — the city code sits right in the path,
so NYC, Boston, DC and the Bay Area are the same shape with a different slug. That
maps onto the destination-slug matching the app already does for climate.

One thing checked because it would have been a silent, expensive bug: the
`station_id` values in `station_information.json` and `station_status.json` are
the **same id space** — all 2,078 overlap, on both the `divvybikes.com` and
`lyft.com` hosts. The join is safe.

### How data moves

```mermaid
flowchart LR
    GBFS["GBFS feed<br/>station_status.json<br/><i>refreshes every 60s</i>"]
    W["Edge Function<br/>poll-stations<br/><i>Supabase Cron, every 30s</i>"]
    DB[("Postgres")]
    P["Next.js page<br/>on Vercel"]

    GBFS -->|"fetch, once per followed system"| W
    W -->|"upsert ONLY changed rows<br/>(secret key)"| DB
    W -->|"one row per run"| DB
    DB -->|"Realtime: one message per changed row"| P
    P -->|"reads follows + stations<br/>(caller's Clerk token, RLS)"| DB
```

Reading it out, which is the thing to be able to do in class:

1. **Cron → worker.** Supabase Cron invokes the function every 30 seconds.
2. **Worker → GBFS.** It reads the set of systems that at least one person
   follows, and fetches `station_status.json` once per system.
3. **Worker → database.** It compares each followed station against what's already
   stored and upserts only rows whose counts actually moved. Then it writes one
   row to `worker_runs`.
4. **Database → page.** Realtime pushes each changed `stations` row to every open
   page subscribed to it.
5. **Page → database.** On load, the page reads the person's follows and the
   current station rows with the caller's Clerk token, so RLS decides what they
   see.

**What breaks if one part changes its half:** if GBFS renames a field the worker
writes nulls and `rows_changed` quietly drops to zero — which is why the runs
table records a count and not just a boolean. If the worker writes every row
instead of changed ones, Realtime burns a month of messages in hours. If the
`stations` table is dropped from the Realtime publication, the page simply gets
nothing, with no error at all.

### Four new tables

Same split the app already uses and has already defended: **reference data nobody
owns, plus one table fenced per person.**

#### bike_systems — reference, read-only

The catalog of supported GBFS systems. Seeded by migration; a new city is one
`insert`, not a redeploy.

| Column | Type | Notes |
| --- | --- | --- |
| `slug` | `text` pk | `chi`, `nyc`, `bos` — the code in the GBFS URL |
| `name` | `text not null` | "Divvy" |
| `city` | `text not null` | "Chicago" — matched against a trip's destination |
| `status_url` | `text not null` | `station_status.json` |
| `information_url` | `text not null` | `station_information.json` |
| `ttl_seconds` | `integer not null default 60` | what the feed advertises |

#### stations — live rows, owned by nobody

One row per station, carrying both the static description and the live counts, so
the page needs no join to render a name.

| Column | Type | Notes |
| --- | --- | --- |
| `system_slug` | `text not null` | → `bike_systems.slug` |
| `station_id` | `text not null` | GBFS id, stable across both feed files |
| `name` | `text` | "Pulaski Rd & 60th Pl" — **nullable on purpose**, see below |
| `lat` / `lon` | `double precision` | from `station_information` |
| `capacity` | `integer` | |
| `bikes_available` | `integer` | live |
| `ebikes_available` | `integer` | live |
| `docks_available` | `integer` | live |
| `last_reported` | `timestamptz` | the feed's own timestamp, not ours |
| `updated_at` | `timestamptz not null default now()` | when *we* last wrote it |

Primary key `(system_slug, station_id)` — that composite is what the upsert
conflicts on.

**Static and live columns are filled on different clocks.** `station_information`
is fetched when a system gains its first follower (and at most hourly after);
`station_status` is fetched every run. Don't collapse these into one fetch — the
information file is 1.1 MB and almost never changes.

**`name` is nullable, and that falls straight out of the two clocks.** A station
can turn up in `station_status` before the next `station_information` fetch has
given it a name. With `not null` that one upsert fails and takes the entire run
down with it; nullable means the row lands with live counts and gains its name
later. Don't "tidy" this to `not null`.

**`station_follows` has deliberately no foreign key to `stations`.** Requiring the
station row to exist first is a bootstrap deadlock: the worker is what fills
`stations`, and it only polls systems somebody follows, so the first person to
follow a station in a new city could never do it. The worker creates the row on
its next run instead, at most one cron interval later.

#### station_follows — one person's choices, RLS fenced

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` pk, `gen_random_uuid()` | |
| `user_id` | `text not null` | Clerk `sub`, **text not uuid** — see the A4 note |
| `system_slug` | `text not null` | |
| `station_id` | `text not null` | |
| `trip_id` | `uuid` | optional → `trips.id`, so a follow can hang off a trip |
| `created_at` | `timestamptz not null default now()` | |

`unique (user_id, system_slug, station_id)` — following twice is a no-op, not an
error. That is the same lesson as "already in your inventory": a repeat is a
reasonable request, not a mistake.

#### worker_runs — the record of every run

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` pk, `gen_random_uuid()` | |
| `started_at` | `timestamptz not null default now()` | |
| `finished_at` | `timestamptz` | |
| `ok` | `boolean not null` | |
| `systems_polled` | `integer not null default 0` | |
| `rows_changed` | `integer not null default 0` | **the 72-not-2078 number** |
| `error` | `text` | null when `ok` |

The page reads this table to decide between *stale* and *down*, so it has to be
readable by any signed-in user — it holds nobody's personal data.

### Row-level security

Enable RLS on all four. The pattern is already established, including the trap:

```sql
-- station_follows: all four policies, and insert/update need WITH CHECK.
-- Without it, USING alone lets someone write a row stamped with another
-- person's user_id. This is exactly what /security-review caught in A4.
create policy "own follows: select" on station_follows for select
  using ((auth.jwt() ->> 'sub') = user_id);
create policy "own follows: insert" on station_follows for insert
  with check ((auth.jwt() ->> 'sub') = user_id);
create policy "own follows: update" on station_follows for update
  using ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);
create policy "own follows: delete" on station_follows for delete
  using ((auth.jwt() ->> 'sub') = user_id);

-- bike_systems, stations, worker_runs: readable by any signed-in user,
-- writable by nobody. The refusal is explicit rather than a missing policy,
-- so it is visible in pg_policies instead of looking like an oversight.
create policy "live data: read" on stations for select to authenticated using (true);
create policy "live data: no writes" on stations for all to authenticated with check (false);
```

Only the worker writes the three shared tables, holding the service role key that
Supabase hands it on its own servers. That key never appears in the repository —
the same rule `lib/supabase-admin.ts` already follows for `climate_cache`.

### The decision that protects both free tiers

**The worker writes only stations somebody actually follows.** Not all 2,078.

Realtime bills every change sent to every open page, and the brief warns a worker
that rewrites every row can spend a month of messages in a few hours. Writing only
followed stations takes a realistic run from ~72 rows to a handful.

The cost, accepted knowingly: a station someone has just started following shows
no live counts until the next run, which is at most 30 seconds. The browse list is
still complete, because static station rows are loaded for the whole system when
it gains its first follower.

**Cadence: every 30 seconds.** The feed only republishes every 60, so polling
faster buys nothing; polling at 30 means a change is visible within about half a
refresh window. That is 86,400 invocations a month against a 500,000 allowance.
Runs that find nothing changed are normal and will show `rows_changed: 0` — that
is the upsert working, not a fault.

### The four states the page must design

Thresholds are expressed in cron intervals so they stay correct if the interval
changes.

| State | Condition | What it says |
| --- | --- | --- |
| **Loading** | no run read yet | first paint, nothing known |
| **Fresh** | last `ok` run ≤ 2 intervals (60s) | the counts are current |
| **Stale** | last `ok` run 2–10 intervals old | "last updated 4 minutes ago" — the data is real but ageing |
| **Down** | latest run has `ok = false`, or no `ok` run in 10 intervals | the worker is failing, and say so rather than showing numbers as if they were live |

*Stale* and *down* are genuinely different and must not look the same: stale means
the pipe is slow, down means it is broken. The runs table is what tells them
apart, which is the reason it exists.

### Where the live layer lives in the UI

It is not a panel bolted to the bottom of one page. The destination already drives
the climate strip and the poster; bikes join that, and the trip page grows a
proper **"what it's like there"** half to sit beside **"what to bring"**.

**It appears on four surfaces, and no fifth tab.** A tab would say this is a new
place to go. It isn't — it's another thing a trip tells you, the same way the day
strip is. The four-tab masthead stays as *Shape of the app* describes it.

| Surface | What shows |
| --- | --- |
| `/trips/[id]` | The panel itself, in the destination cluster — after `ConditionsNote`, **before** the packing list. Position is what makes it a peer rather than an appendix. |
| `/` home | The next-departure line gains live counts: *"Chicago, in 3 days — 7 items left · 4 bikes at Clark & Elm"*. The strongest returning-visit hook in the app, because you glance at it on the way out of the door. |
| `/trips` upcoming | One live count per trip card whose destination has a system. |
| `/trips/new` | Nothing new. The **destination field is the hook** — it already matches a slug for climate, and the same match finds a `bike_systems` row. No extra input, no new concept. |

**The starters already work, which was checked rather than assumed.** `STARTERS` in
`lib/starters.ts` carries real destinations — Chicago, Lisbon, New York — so
"A weekend at home" lands on Divvy and "Three days for a conference" lands on Citi
Bike. A brand-new account taps a starter and gets live data on its first screen,
with nothing added. Don't "fix" the starters for this; they were already right.

**Lisbon is the interesting one, and it is not a bug.** There is no seeded system
for it, so the panel must have a designed absence: a quiet line saying this
destination has no bikeshare, not an error, not a spinner, and not a blank space
where a panel should be. That is the brief's *nothing found* state, and it will be
the state a third of the starter trips land in — so it gets designed first, not
last.

**Following stations uses components that already exist.** The nearby stations
render as a `SuggestionList`, and the ones you follow become `Chip`s. No one-off
controls — the grep in *Requirements this app is graded on* must keep coming back
clean.

**The freshness line sits above the panel, once.** Not a badge per row. Four
states as specified above, and *stale* and *down* must not look alike. Per the
design system an error is a rule, an icon and a tint — never an accent-coloured
button, and the accent still belongs to the primary action alone.

**When a row changes, tint it briefly and let it fade.** `selected` (`#EDD8CC`),
no glow and no animation beyond the fade — this is the one moment the live layer
is visible as *live*, and it has to stay inside a design system whose border
radius is zero.

### The day plan, and why it exists

The bikes panel was coherent on its own and disconnected from the app around
it. The conditions strip **changes the packing list** — the band and wetness
are what generated it. The bikes panel sat in the same cluster, looked like a
peer, and produced nothing. It was a readout.

An itinerary fixes that, but only the generated kind. A hand-authored plan
would be a third concept competing for the page; a plan that is **a function of
the destination and the dates** is the same move the packing list already
makes, and it gives the live layer something to be about.

**`lib/places.ts` is curated, and the app never geocodes it.** Same pattern as
`photos.ts`. Each `area` was resolved once through Open-Meteo's geocoder and
accepted only if it landed within 25km of the city claiming it — which rejected
four of the first eight New York candidates. "Williamsburg" resolves 215km
away, "SoHo" 506km, "Chelsea" 94km, "Dumbo" to another continent. Famous
neighbourhood names are not unique. **Geocode and check the distance before
adding one; don't type coordinates from memory.**

**`lib/itinerary.ts` picks a place per day from the same per-day normals the
strip draws.** A wet or cold day takes an indoor place; a fine day takes an
outdoor one; nothing repeats until the list runs out. The second half of that
rule was missing at first, and a dry run caught it: with only the indoor
preference, a fine Sunday took the museum because the museum sorts first,
leaving a wet Tuesday one fewer indoor option. **Indoor places are the scarce
resource** — spend them on the days that need them.

**Nothing is stored.** The plan is derived, so it survives a reload with no
table behind it, and the same trip next year regenerates against next year's
dates. That is deliberate: a stored plan would be trip-specific state that
*doesn't* carry forward, which would compete with the correction loop instead
of leaving it alone.

**`citySlugFor` shares a slug space with `bike_systems`.** `chi` has places and
live bikes; `lis` has places and no bikes, so a station query for `lis` returns
nothing. That is the correct behaviour, not a special case to code around.

**The day's dock has a Watch control, and that is load-bearing.** The worker
only polls followed stations — the thing that keeps writes at 3% of the feed —
so a planned day shows a dock and a distance but no numbers until somebody
asks. One tap is the ask, and counts arrive within one cron interval. It also
inverts the discovery problem: you follow the dock *by Tuesday's plan* rather
than hunting a station name you were never going to know.

### Repo layout — one repo, two runtimes

No workspaces, no `apps/` restructure. `supabase/` already sits beside `src/`:

```
wanderlist2/
├── src/                     ← Next.js, deploys to Vercel
├── supabase/
│   ├── migrations/          ← 7 from A4, plus A5's
│   ├── functions/
│   │   ├── _shared/         ← underscore: not deployed as a function
│   │   └── poll-stations/
│   │       └── index.ts     ← Deno. Deploys to Supabase.
│   └── config.toml
└── tsconfig.json
```

**`"supabase"` is in `tsconfig.json`'s `exclude`, and must stay there.** Without
it `next build` type-checks Deno code and fails on `Deno` being undefined. Note
the subtlety: `exclude` only drops files from the initial glob — if anything under
`src/` *imports* a file under `supabase/`, TypeScript pulls it back in and checks
it. Keep anything shared to plain types with no `Deno.` and no remote imports.

## Hard constraints

These come from the assignment brief. Do not violate them, and push back if asked to.

**Assignment 4 reversed the first two constraints of Assignment 3.** The old rules
said no external APIs, no database and no accounts; the brief now requires all
three, and all three are built. The notes below are the current rules. Anywhere
this file mentions `localStorage`, it is describing what Assignment 3 did and
what replaced it — never current behaviour.

**Assignment 5 adds four more, and relaxes one.**

- **A worker runs on a schedule**, as a Supabase Edge Function invoked by Supabase
  Cron. It writes with the service role key, which Supabase supplies on its own
  servers and which never enters the repository.
- **The page updates without a refresh**, over Supabase Realtime, and must design
  loading, fresh, stale and down. Realtime fails *silently* when any of its three
  prerequisites is missing — table in the publication, read access, an RLS policy
  that lets the person read it — so check all three before debugging code.
- **Each person chooses what they follow**, with row-level security on those
  choices.
- **One live source**, and it is bikeshare over GBFS. Open-Meteo stays where it is;
  it supplies monthly climate normals to the packing list and is not the live
  source. Two live sources would muddy the "where do you call it, and why there"
  answer, so there is exactly one.
- **The relaxed one:** the Supabase MCP server can no longer be read-only, because
  the agent deploys the worker and sets its schedule through it.

- **Accounts are required.** Clerk, on **development keys only**; production keys
  need a domain we don't own. A signed-out visitor must reach nobody's data.
- **Data lives in Supabase**, with row-level security on every table.
- **Exactly one external API** does real work. More than one and none of them is
  load-bearing, which muddies the "where do you call it, and why there" answer
  the assignment grades. Nothing API-related is built until auth and the database
  are standing — it's step 6 for a reason.
- **Keys go in `.env.local`, never in the code or a commit.** `.claude/settings.json`
  denies `Read`, `Edit` and `Write` on `**/.env*` — globbed, because the first
  version used `./.env.*` and anchored the `./` to the session root rather than
  the repo, so it silently guarded nothing. Do not add `Bash(cat:*)`, `head`,
  `tail`, `grep` or `python3` to the allow list: those read `.env.local`
  straight past the deny rule.
- **No new packages** beyond what Clerk, Supabase and Playwright require, without
  asking first. Still no state library, no form library, no date library, no UI
  kit, no icon package.
- Deployed on Vercel's free Hobby plan. Work on a branch; `main` holds the
  Assignment 3 submission until the work is reviewed and merged.
- `AGENTS.md` (this file) is the context file. There must be no `CLAUDE.md`.

**What development keys cost, and what's done about it.** "Clerk, on development
keys only" reads like a deployment convenience. It isn't — it's a security
trade-off, and the second `/security-review` pass found the sharp edge. On an
instance of type `development`, Clerk accepts the token identifying a *client*
from the **query string** as well as from a cookie, and the only gate is
`searchParams.has("__clerk_db_jwt")`: no signature check, no origin check. Proven
against the running app rather than inferred — a document navigation to
`/?__clerk_db_jwt=FORGED` was 307'd straight to
`…clerk.accounts.dev/v1/client/handshake?…&__clerk_hs_reason=dev-browser-sync&__clerk_db_jwt=FORGED`,
with the caller's token forwarded verbatim. With a *real* token — one an attacker
reads out of their own cookie jar after signing up — the handshake returns that
client's session cookies, the parameter is scrubbed from the URL, and the visitor
is quietly operating inside the attacker's account. **Row-level security is no
defence against this**, which is the part worth being able to say out loud: the
policies enforce the identity they're given, and this attack hands them the wrong
one. A fence below the auth layer cannot save you from a lie told above it.

`src/proxy.ts` now strips any inbound `__clerk_db_jwt` query parameter before
Clerk's middleware sees it and redirects to the clean URL. That is safe *here*
because sign-in is embedded and same-origin; the parameter's legitimate job is
carrying the token back from a hosted Account Portal on `*.accounts.dev`, which
this app never uses. Don't move to Clerk's hosted pages without revisiting it,
and don't extend the strip to `__clerk_handshake*` — the genuine handshake return
needs those. Verified after the change by signing in through the real form with
an emailed code, not just through `clerk.signIn()`. It does **not** make a
development instance production-safe; only production keys do, and the brief
forbids them.

**Two things about the Clerk instance live in the dashboard, not in this repo,
and both are visible to a classmate.** Read from the instance's own
`/v1/environment` rather than guessed:

- **Email is now a required attribute — fixed, and worth not undoing.** It used to
  be optional, as were `username` and `password`, and with *nothing* required
  Clerk's `<SignUp />` had no field it could collect: the sign-up card offered
  only "Continue with Google", so anyone without a Google account could not create
  one at all. Sign-*in* was unaffected, because email codes work for accounts that
  already exist, which is exactly why it went unnoticed — the only way to find it
  was to try signing up as a stranger. Now `email_address.required` is true and a
  new account is created with an email and a code, verified end to end through the
  real form. If the sign-up card ever shows nothing but social buttons again, this
  setting is the first place to look.
- `display_config.application_name` is still **"HW4"**, so the card reads "Sign in
  to HW4".

Neither is settable from the CLI (`clerk config pull`/`patch` don't carry them),
so they can't be fixed from here.

**Keep the walkthrough's status panel current.** `../assignment-4-walkthrough.html`
(one level up, outside the repo) carries a **Where this stands** panel: one row
per assignment step, with what is actually built. Update it when a step changes
state — finished, started, or found to be wrong — and not otherwise. A commit is
not a milestone; "sign-in works and signed-out is locked out" is. Roughly one
edit per step, eight or so for the whole assignment. Don't narrate progress into
it, and don't touch the checkboxes below it: those are the user's, stored in
their browser, and overwriting them isn't possible from here anyway.

## Stack notes that actually bite

Next.js 16.4.2, React 19.3, Tailwind v4. Three things differ from older training data:

1. **`cacheComponents: true`** is on in `next.config.ts`. Next uses React
   `<Activity>` to keep recently visited routes *mounted* (hidden) across client-side
   navigation. Per-route component state is therefore preserved, not torn down.
   **Consequence:** never let two routes each hold their own copy of the trips state —
   one will go stale. All trip state lives in a single provider in the root layout
   (`src/app/providers.tsx`), and every route reads it through the `useTrips()` hook.

2. **Tailwind v4 has no `tailwind.config.js`.** Design tokens are declared in
   `src/app/globals.css` with `@theme`. Add a color there and it becomes a utility
   (`--color-accent` → `bg-accent`, `text-accent`).

3. **The first-visit gate has three states, not two.** A returning person must
   never see the first-visit screen flicker past. Assignment 3 solved that with an
   inline `<head>` script reading `localStorage` before first paint; that script
   and `lib/storage.ts` are both **gone**, because the answer now comes from
   Supabase over the network and cannot be known before paint — and because with
   accounts there are three cases: signed out, signed in with nothing, signed in
   with trips.

   `<html>` therefore ships `data-has-trips="loading"`, which `globals.css` uses to
   hide *both* faces, and `TripsProvider` rewrites it to `yes`/`no` once the fetch
   resolves. A frame of nothing beats a frame of the wrong screen. If you add a
   fourth state, the CSS gate and that effect must change together.

4. **Hand-written CSS must go in `@layer base`.** Tailwind v4 emits utilities
   inside a cascade layer, and unlayered rules beat layered ones regardless of
   specificity. A bare `a { text-decoration: underline }` in `globals.css`
   therefore won against `no-underline` on *every* link, underlining the text
   inside every button-styled link. Element defaults belong in `@layer base`;
   only classes that must win (`.checkbox`, the `[data-when]` gate) stay
   unlayered.

5. **Tailwind arbitrary values can't hold an inline SVG data URI.** The checkbox
   tick was written as `bg-[url('data:image/svg+xml;utf8,<svg …>')]` and silently
   compiled to `background-image: none` — the angle brackets, hash and spaces
   don't survive. It lives in `globals.css` as `.checkbox:checked` instead. Note
   also that editing `globals.css` reliably needs a dev-server restart before
   Turbopack serves the change — budget for it rather than debugging a ghost.

Generated route types are real: use `LayoutProps<"/">` and `PageProps<"/trips/[id]">`
rather than hand-writing props.

## Design system — Café Terrace

Carried over from Assignment 2 (https://design-hw2.vercel.app/design-systems/a).
The mood: *parchment and pressed ink under a red awning. Printed, unhurried, worn at
the corners.* It should read like a typeset document, not a web app — which suits a
a departure board and a packing manifest.

Colors, declared as tokens in `globals.css`:

| Token | Hex | Use |
|---|---|---|
| `background` | `#DED0B2` | the page — **deepened from `#E8DCC5`** |
| `surface` | `#FDFBF7` | cards, inputs, panels — lifted with the page |
| `surface-raised` | `#EFE9DC` | hover fill on quiet controls |
| `selected` | `#F0DBCB` | chosen rows and chips |
| `ink` | `#2B1D16` | headings and body |
| `muted` | `#615549` | captions, meta, placeholders — darkened with the page |
| `rule` | `#B3A99D` | dividers and plate rules |
| `rule-strong` | `#786D62` | input and control edges — darkened twice now, each time to keep 3:1 against a deepening page |
| `accent` | `#AE3220` | primary action only |
| `success` | `#41662F` | confirmation |
| `error` | `#7B1E2B` | failure and destructive |
| `warning` | `#7A4F10` | caution |

Type: **Fraunces** for display and headings, **Source Sans 3** for body and labels.
Display 56/52 w600 `-0.02em`; Heading 28/34 w600; Body 16/26 w400 (max 68 characters
per line); Label 11/16 w600 uppercase `0.14em`.

Shape and rules — these are what make it look printed, so hold the line:
- **Border radius is 0.** Controls may use 2px. Nothing rounder is permitted.
- Shadows are hard-offset with **no blur** (`none`, `raised`, `lifted`).
- 1px hairline dividers, 1px strong on control edges, 2px section rules, 3px accent
  rule on a selected tab.
- Focus outline 2px, offset 2px — tomato on quiet controls, espresso on accent fill.
- Spacing is a 4px scale: 4, 8, 12, 16, 24, 32, 48, 64.


**The palette was re-balanced after Assignment 4 feedback, and the numbers are
the reason.** The note was that the interface suffered from beige-on-beige, and
it did: `surface` sat at **1.19:1** against `background`, so a card and the page
it lay on were nearly the same value and every panel read flat.

The first attempt was to lift `surface` alone, which caps at 1.27 — not enough.
Deepening the page is what works, and the cost is that it drags the two tokens
measured against the page below their floors. So they move too:

| Pair | Before | After | Floor |
| --- | --- | --- | --- |
| `surface` on `background` | 1.19 | **1.48** | — |
| `muted` on `background` | 4.77 | **4.74** | 4.5 |
| `muted` on `surface` | 5.66 | **7.00** | 4.5 |
| `rule-strong` on `background` | 3.14 | **3.31** | 3.0 |
| `ink` on `background` | 12.0 | **10.7** | 4.5 |

**If you deepen the page again, re-check those four.** `rule-strong` exists to
clear 3:1 and has now been darkened twice for exactly this reason.

**Colour is not the only lever, and it isn't the strongest one here.** A
two-tone parchment palette can only separate so far before it stops being
parchment. Depth does the rest: panels carry `shadow-raised` — hard offset, no
blur, as the shape rules require — which is how `/trips` already distinguished
its board. Reach for the shadow before reaching for more contrast.

**Category colours** live in `src/components/categoryStyle.ts` — one muted pigment
per packing category (slate, rust, olive, leather, pine, graphite, ochre). They're
there so a 24-item list can be scanned by section. None of them come near the
accent, which still belongs to the primary action alone.

Component rules: primary button is the only accent fill and shifts down 1px when
pressed; secondary never uses accent; links are always underlined. Checkbox is
square, radio is round. Badges are status only, never clickable. An error is a rule,
an icon and a tint — **never an accent-coloured button**.

## Requirements this app is graded on

Assignment 4 adds these, and they are the ones that decide the grade:

- **Accounts:** sign up, sign in, sign out with Clerk. A signed-out visitor sees
  nobody's data — check it signed out, don't assume it.
- **Data in Supabase**, row-level security on every table, each person seeing only
  their own rows.
- **One external API**, with designed states for loading, nothing found, and the
  API being down.
- **Persistence:** what you save is still there after signing out and back in, on
  another device. This is the requirement that makes accounts worth having here —
  pack on a laptop over several evenings, tick items off on a phone at the suitcase.
- **Keys** in environment variables, never in the code or the repository, with a
  deny rule for `.env` files.
- **One Playwright test** proving two users can't see each other's data, *watched
  failing* before it passes. Break RLS on purpose to see it fail.
- **`/security-review`** run on the branch, findings handled.
- **Deployed on Vercel**, where a classmate can make an account and use it.
- A commit history that shows progress. A one-shot submission is marked incomplete.

Assignment 3's requirements still hold — the UI/UX work is not superseded:

- A page per flow step with shared navigation, and it's clear where you are.
- First visit gives something useful immediately; no dead-end empty screen.
- Forms: one column, a real `<label>` on every field, errors rendered **next to the
  field** and phrased as an instruction ("Enter a destination." not "Invalid input."),
  and **every value the person typed survives a failed submit**.
- Coming back: the app remembers, and the returning experience is designed, not
  incidental.
- Shared components used consistently — `Button`, `Field` (with `TextInput`,
  `Select`, `TextArea`, `Checkbox`), `Card`, and `Controls` (`Stepper`,
  `QuietAction`, `SegmentedControl`, `Chip`, `SuggestionList`). **Don't style a
  one-off control inline.** The check is a grep: `<button`, `<input`,
  `<textarea>` and `<select` should appear nowhere outside those three files.
- Accessibility: full keyboard operation, visible focus, real labels, errors
  associated with their field (`aria-describedby` + `role="alert"`), and text
  contrast checked.
- Simplicity: prefer removing a step, a field, or an interaction.

## Conventions

- `src/lib/` is pure logic with no React, and keeping it readable is the point:
  `climate.ts`, `suggestions.ts`, `trips.ts`, `inventory.ts`, `starters.ts`,
  `photos.ts`, `types.ts`, `open-meteo.ts`, `trip-days.ts`, `trips-db.ts`, plus
  the three Supabase clients below. (`storage.ts` and `example.ts` are gone —
  localStorage was Assignment 3's backend, and the example was removed.)
  **`use-climate.ts` is the one exception** and it is named so nobody has to
  discover it: it holds `useClimate`/`useTripClimate`, which are hooks. It sits
  here because it is the companion to `open-meteo.ts` and reads as one subject
  with it. If a second React file ever wants in, move this one to
  `src/components/` instead of widening the rule.
- Three Supabase clients, and the distinction is the access-control story:
  `lib/supabase.ts` (browser, caller's Clerk token), `lib/supabase-server.ts`
  (route handlers, also the caller's token), and `lib/supabase-admin.ts` (service
  role, `import "server-only"`, used for exactly one insert into `climate_cache`).
  Never reach for the third for anything with a `user_id`.
- `src/components/` is the shared component set.
- Dates are stored as `YYYY-MM-DD` strings, never `Date` objects, so a row reads
  plainly in the table editor and is timezone-stable.
- IDs come from `crypto.randomUUID()` in the client, not the column default, so
  an optimistic row carries its final id immediately.
- Commit in small steps — the commit history is graded.
