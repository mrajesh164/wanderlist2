import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";

/**
 * Two people, two accounts, one database — and neither can see the other's
 * trips.
 *
 * This is the one test the assignment asks for, and it is deliberately an
 * end-to-end test rather than a unit test of the policies. A unit test would
 * assert that the SQL says what I wrote; this asserts that a real browser, with
 * a real Clerk session, hitting a real Postgres with row-level security on,
 * cannot read somebody else's rows. Those are different claims, and only the
 * second one is worth anything.
 *
 * It is written to FAIL if `trips`'s select policy is loosened. That is the
 * whole point: a test that passes whether or not RLS works proves nothing. To
 * see it fail on purpose:
 *
 *   alter policy "Select own trips" on public.trips using (true);
 *
 * ...then run it again. User B's board will show User A's trip and the
 * assertion below will catch it. Put it back with:
 *
 *   alter policy "Select own trips" on public.trips
 *     using ((auth.jwt() ->> 'sub') = user_id);
 */

const USERS = {
  a: {
    email: "wanderlist-a+clerk_test@example.com",
    /* Unique per run, so a leftover row from an earlier run can never be
       mistaken for a leak — and so a leak is unmistakably *this* run's. */
    trip: `A-only-${Date.now()}`,
    destination: "Oslo",
  },
  b: {
    email: "wanderlist-b+clerk_test@example.com",
    trip: `B-only-${Date.now()}`,
    destination: "Barcelona",
  },
} as const;

test.beforeAll(async () => {
  /* Fetches the testing token that lets automated browsers past Clerk's bot
     protection. Without it the sign-in form silently refuses to submit. */
  await clerkSetup();
});

/**
 * Sign in through Clerk's own test helper rather than by driving its form.
 *
 * Two attempts at the form route failed in instructive ways: the first assumed
 * a password field and timed out on "Check your email" (this instance uses
 * email codes, not passwords), and the second raced Clerk's prepare request —
 * the code input renders before a code has actually been sent, so the second
 * user got "You need to send a verification code before attempting to verify"
 * while the first sailed through. That asymmetry is the signature of a race.
 *
 * Driving a vendor's hosted form is testing the vendor. What this file is for
 * is proving row-level security fences two accounts apart, and `clerk.signIn`
 * produces exactly the same thing that matters for that — a real session whose
 * token Supabase will accept. `email_code` works without a mailbox because the
 * addresses end in `+clerk_test@example.com`, which Clerk treats as test users.
 */
async function signIn(page: Page, email: string) {
  /* Clerk must be loaded before the helper runs, and `/` is the only public
     page that loads it. */
  await page.goto("/");
  await clerk.signIn({
    page,
    signInParams: { strategy: "email_code", identifier: email },
  });

  /* Signed in means the masthead shows the tabs, which are hidden signed out.
     Checking that rather than a URL is deliberate: Clerk redirects before the
     session is necessarily usable by Supabase, so a URL assertion would pass
     too early and the next step would race the data layer.

     Scoped to the masthead nav because home also has an "Upcoming" card, and an
     unscoped locator matched both. */
  await page.goto("/trips");
  await expect(
    page.getByRole("navigation", { name: "Sections" }).getByRole("link", {
      name: "Upcoming",
    }),
  ).toBeVisible();
}

async function createTrip(
  page: Page,
  name: string,
  destination: string,
): Promise<void> {
  await page.goto("/trips/new");
  /* Exact labels from TripForm.tsx. Loose regexes matched the wrong fields —
     "name" also matches nothing useful and "where" matches the conditions
     picker — so these are deliberately literal and will fail loudly if the
     copy changes, which is the right failure. */
  await page.getByLabel("What's the trip?").fill(name);

  /* Picked from the list, not typed, because the form now requires it: a
     destination has to be a city the live layer can actually serve. Typing
     the name and submitting used to work and no longer does, which is how
     this test caught that change. Driving the real path is also the better
     test -- it is what a person does. */
  await page.getByLabel("Where are you going?").fill(destination.slice(0, 4));
  await page.getByRole("button", { name: new RegExp(destination) }).first().click();
  await expect(page.getByLabel("Where are you going?")).toHaveValue(destination);

  /* Dates: a week, starting a fortnight out, so the trip lands in "Upcoming"
     rather than "Previous". */
  const start = new Date();
  start.setDate(start.getDate() + 14);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  await page.getByLabel("First day").fill(iso(start));
  await page.getByLabel("Last day").fill(iso(end));

  await page.getByRole("button", { name: "Build the list" }).click();

  /* The trip page shows the name as its heading once the list is built. */
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("two users cannot see each other's trips", async ({ browser }) => {
  /* Separate contexts, not separate pages: two sessions in one context would
     share cookies and the second sign-in would simply replace the first. */
  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;

  try {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await test.step("user A signs in and saves a trip", async () => {
      await signIn(pageA, USERS.a.email);
      await createTrip(pageA, USERS.a.trip, USERS.a.destination);
    });

    await test.step("user B signs in and saves a trip", async () => {
      await signIn(pageB, USERS.b.email);
      await createTrip(pageB, USERS.b.trip, USERS.b.destination);
    });

    await test.step("B's board shows B's trip and not A's", async () => {
      await pageB.goto("/trips");
      await expect(pageB.getByText(USERS.b.trip)).toBeVisible();
      /* The assertion that row-level security is doing its job. If the select
         policy is loosened to `using (true)`, A's trip appears here and this
         line is what catches it. */
      await expect(pageB.getByText(USERS.a.trip)).toHaveCount(0);
    });

    await test.step("A's board shows A's trip and not B's", async () => {
      await pageA.goto("/trips");
      await expect(pageA.getByText(USERS.a.trip)).toBeVisible();
      await expect(pageA.getByText(USERS.b.trip)).toHaveCount(0);
    });

    await test.step("the inventories are separate too", async () => {
      /* Trips and kit_items are fenced by separate policies, so checking only
         trips would leave half the per-user data untested. Each person's
         inventory is derived from their own trip, so A's destination-specific
         items must not appear for B. */
      await pageB.goto("/inventory");
      await expect(pageB.getByText(USERS.a.trip)).toHaveCount(0);
    });
  } finally {
    await contextA?.close();
    await contextB?.close();
  }
});
