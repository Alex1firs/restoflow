/**
 * Staging smoke test — the real deployed environment, over the real network.
 *
 * `marketplace-e2e-demo.ts` proves the logic in one process with fake
 * databases. This proves the *deployment*: that the staging Vercel host is up,
 * that it is wired to the staging Firebase project, that Dispatcher Staging
 * answers it, and — most importantly — that one signed-in customer cannot read
 * another's data.
 *
 * It exercises the customer API exactly as the phone does: an ID token in an
 * Authorization header, and nothing else.
 *
 *   RESTOFLOW_STAGING_URL=https://<preview>.vercel.app \
 *   STAGING_ID_TOKEN=<token for customer A> \
 *   STAGING_OTHER_ID_TOKEN=<token for customer B> \
 *   npx tsx scripts/staging-smoke.ts
 *
 * Obtain the tokens by signing in to the staging app; the sign-in screen logs
 * them in staging builds. They expire after an hour.
 *
 * ── What this will not do ────────────────────────────────────────────────────
 * It refuses to run against a host that is not obviously staging, it never
 * writes to a restaurant or an order it did not create, and it places at most
 * one test checkout — which stops at the payment intent, because no card is
 * charged without a human.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.staging" });

const BASE = (process.env.RESTOFLOW_STAGING_URL ?? "").replace(/\/$/, "");
const TOKEN_A = process.env.STAGING_ID_TOKEN ?? "";
const TOKEN_B = process.env.STAGING_OTHER_ID_TOKEN ?? "";

/** Hosts that are definitely not staging. */
const PRODUCTION_HOSTS = [/^https:\/\/(www\.)?restoflow\.(com|ng|app)/i];

let passed = 0, failed = 0, skipped = 0;
const results: string[] = [];

function ok(name: string) { passed++; results.push(`  ✓ ${name}`); console.log(`  ✓ ${name}`); }
/**
 * A check that could not be exercised.
 *
 * Counted separately and loudly, never as a pass. Several assertions below sit
 * downstream of the Dispatcher call: if delivery is unreachable, the cart is
 * refused before the rule under test is ever consulted, and the check "passes"
 * for the wrong reason. A suite that goes green because the system is broken
 * is worse than no suite.
 */
function skip(name: string, why: string) { skipped++; results.push(`  – ${name} — ${why}`); console.log(`  – ${name}\n      SKIPPED: ${why}`); }
function bad(name: string, why: string) { failed++; results.push(`  ✗ ${name} — ${why}`); console.log(`  ✗ ${name}\n      ${why}`); }

async function call(path: string, opts: { token?: string; method?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}/api/mobile/v1${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* an empty or non-JSON body is itself a result */ }
  return { status: res.status, json: json as Record<string, unknown> | unknown[] | null };
}

async function main() {
  if (!BASE) throw new Error("RESTOFLOW_STAGING_URL is not set.");
  for (const p of PRODUCTION_HOSTS) {
    if (p.test(BASE)) throw new Error(`REFUSING TO RUN: "${BASE}" looks like production.`);
  }
  if (!/vercel\.app|staging|localhost|127\.0\.0\.1/i.test(BASE)) {
    throw new Error(
      `REFUSING TO RUN: "${BASE}" is not recognisably a staging host.\n` +
      `A smoke test that places orders must never be pointed at an unknown environment.`
    );
  }
  if (!TOKEN_A) throw new Error("STAGING_ID_TOKEN is not set. Sign in to the staging app to get one.");

  console.log(`\nStaging smoke test → ${BASE}\n`);

  // ── 1. The API is reachable and the flag is on ────────────────────────────
  console.log("Reachability");
  {
    const r = await call("/feed?lat=6.4474&lng=3.4736");
    if (r.status === 404) bad("the marketplace API is live", "404 — MARKETPLACE_ENABLED is off, or this host has no marketplace build");
    else if (r.status !== 200) bad("the marketplace API is live", `expected 200, got ${r.status}`);
    else ok("the marketplace API is live");
  }

  // ── 2. Discovery shows opted-in restaurants and only those ────────────────
  console.log("\nDiscovery");
  {
    const r = await call("/feed?lat=6.4474&lng=3.4736");
    // The feed is RAILS, not a flat list: featured / nearYou / fastDelivery /
    // offers / cuisines / popularDishes. A restaurant leaking into any one of
    // them is a leak, so the check unions them all rather than picking one.
    const feed = (r.json ?? {}) as Record<string, unknown[]>;
    const rails = ["featured", "nearYou", "fastDelivery", "offers"];
    const slugs = rails.flatMap((k) => ((feed[k] ?? []) as Array<{ slug?: string }>).map((x) => x.slug));
    if (slugs.length === 0) bad("the feed returns restaurants", "every rail was empty — has the seed script been run?");
    else ok(`the feed returns restaurants (${new Set(slugs).size} distinct across ${rails.length} rails)`);

    // The control case. This restaurant is live and trading in staging and has
    // never opted in; if it appears here, the opt-in default is broken and no
    // production restaurant is safe.
    if (slugs.includes("stg-internal-only")) {
      bad("a restaurant that never opted in stays invisible", "stg-internal-only appeared in the customer feed");
    } else ok("a restaurant that never opted in stays invisible");
  }

  {
    const r = await call("/restaurants/stg-trishas-kitchen");
    // The menu arrives grouped: categories[].items[].
    const cats = ((r.json as { categories?: Array<{ label: string; items: Array<{ id: string; available: boolean; priceMinor: number }> }> })?.categories ?? []);
    const items = cats.flatMap((c) => c.items);
    const ids = items.map((i) => i.id);
    if (r.status !== 200) bad("a restaurant page loads", `status ${r.status}`);
    else ok(`a restaurant page loads (${ids.length} items)`);
    // A POS-only item must never cross into the customer app.
    if (ids.includes("stg-staff-meal")) bad("a pos_only item stays out of the app", "stg-staff-meal was served to a customer");
    else ok("a pos_only item stays out of the app");

    // Markup is applied server-side: ₦3,500 base + 20% → ₦4,200, rounded to ₦50.
    const jollof = items.find((i) => i.id === "stg-jollof");
    if (!jollof) bad("the menu is priced for the marketplace", "stg-jollof missing");
    else if (jollof.priceMinor !== 420_000) bad("the menu is priced for the marketplace", `jollof came back at ${jollof.priceMinor}, expected 420000`);
    else ok("the menu is priced for the marketplace (jollof ₦4,200 = ₦3,500 + 20%)");

    const soldOut = items.find((i) => i.id === "stg-soldout");
    if (soldOut && soldOut.available === false) ok("a sold-out item is listed but marked unavailable");
    else bad("a sold-out item is listed but marked unavailable", soldOut ? "it is marked available" : "it is missing entirely");
  }

  {
    const r = await call("/restaurants/stg-internal-only");
    if (r.status === 200) bad("a non-marketplace restaurant has no customer page", "it returned 200");
    else ok(`a non-marketplace restaurant has no customer page (${r.status})`);
  }

  // ── 3. Authentication ─────────────────────────────────────────────────────
  console.log("\nAuthentication");
  {
    const r = await call("/me");
    if (r.status !== 401) bad("an unauthenticated request is refused", `expected 401, got ${r.status}`);
    else ok("an unauthenticated request is refused");
  }
  {
    const r = await call("/me", { token: "not-a-real-token" });
    if (r.status !== 401) bad("a forged token is refused", `expected 401, got ${r.status}`);
    else ok("a forged token is refused");
  }

  let meA: { id?: string } | null = null;
  {
    const r = await call("/me", { token: TOKEN_A });
    if (r.status !== 200) { bad("a valid token identifies the customer", `status ${r.status}`); }
    else { meA = r.json as { id?: string }; ok(`a valid token identifies the customer (${meA?.id})`); }
  }

  // ── 4. Isolation — the assertion this whole environment exists for ────────
  console.log("\nIsolation");
  if (!TOKEN_B) {
    bad("customer B cannot read customer A's data", "STAGING_OTHER_ID_TOKEN is not set — this check was SKIPPED, not passed");
  } else {
    const meB = (await call("/me", { token: TOKEN_B })).json as { id?: string };
    if (meB?.id && meA?.id && meB.id === meA.id) {
      bad("the two tokens are different customers", "both tokens resolved to the same uid");
    } else {
      ok(`the two tokens are different customers (${meA?.id} vs ${meB?.id})`);

      const ordersA = (await call("/orders", { token: TOKEN_A })).json as Array<{ id: string }>;
      const ordersB = (await call("/orders", { token: TOKEN_B })).json as Array<{ id: string }>;
      const idsB = new Set((ordersB ?? []).map((o) => o.id));
      const overlap = (ordersA ?? []).filter((o) => idsB.has(o.id));
      if (overlap.length) bad("order lists do not overlap", `${overlap.length} order(s) appeared in both`);
      else ok("order lists do not overlap");

      // The direct IDOR attempt: B asks for A's order by id.
      if (ordersA?.length) {
        const target = ordersA[0].id;
        const r = await call(`/orders/${target}`, { token: TOKEN_B });
        if (r.status === 200) bad("customer B cannot fetch customer A's order", `got 200 for ${target} — THIS IS AN IDOR`);
        else if (r.status !== 404) bad("customer B cannot fetch customer A's order", `expected 404, got ${r.status} — a distinguishable refusal confirms the id exists`);
        else ok("customer B cannot fetch customer A's order (404)");

        const t = await call(`/orders/${target}/tracking`, { token: TOKEN_B });
        if (t.status === 200) bad("customer B cannot track customer A's courier", `got 200 — courier location leaked`);
        else ok(`customer B cannot track customer A's courier (${t.status})`);
      } else {
        results.push("  – no orders yet for customer A; the IDOR check needs one placed order");
        console.log("  – no orders yet for customer A; the IDOR check needs one placed order");
      }

      // And an address id that belongs to A must be nothing to B.
      const addrA = (await call("/me/addresses", { token: TOKEN_A })).json as Array<{ id: string }>;
      if (addrA?.length) {
        const q = await call("/cart/quote", {
          token: TOKEN_B, method: "POST",
          body: { restaurantSlug: "stg-trishas-kitchen", addressId: addrA[0].id, lines: [{ itemId: "stg-jollof", quantity: 1, options: [{ groupId: "protein", choiceId: "chicken" }] }] },
        });
        // 422 NO_ADDRESS is the right answer: B's address book does not
        // contain that id, so it resolves to nothing rather than to A's home.
        const code = (q.json as { code?: string })?.code;
        if (q.status === 200) bad("customer B cannot quote to customer A's address", "the quote succeeded — an address oracle");
        else if (code !== "NO_ADDRESS") bad("customer B cannot quote to customer A's address", `refused with ${code ?? q.status}, expected NO_ADDRESS`);
        else ok("customer B cannot quote to customer A's address");
      }
    }
  }

  // ── 5. Pricing ────────────────────────────────────────────────────────────
  console.log("\nPricing");
  const addresses = (await call("/me/addresses", { token: TOKEN_A })).json as Array<{ id: string; label: string }>;
  const home = addresses?.find((a) => a.label === "home") ?? addresses?.[0];
  const far = addresses?.find((a) => a.label === "work");

  if (!home) {
    bad("the customer has an address", "none found — run the seed script with the right STAGING_CUSTOMER_UID");
  } else {
    const q = await call("/cart/quote", {
      token: TOKEN_A, method: "POST",
      body: {
        restaurantSlug: "stg-trishas-kitchen", addressId: home.id,
        lines: [{ itemId: "stg-jollof", quantity: 2, options: [{ groupId: "protein", choiceId: "beef" }, { groupId: "extras", choiceId: "plantain" }] }],
      },
    });
    const body = q.json as Record<string, number | boolean | string>;
    if (q.status !== 200) {
      bad("a cart quotes", `status ${q.status} ${JSON.stringify(q.json)}`);
    } else if (!body.serviceable) {
      bad("a cart quotes", `unserviceable: ${body.reason} — is Dispatcher Staging reachable?`);
    } else {
      ok(`a cart quotes (total ${Number(body.totalMinor) / 100} NGN, ETA ${body.etaMins}m)`);
      // Delivery came from Dispatcher, which means the cross-system call worked.
      if (Number(body.deliveryFeeMinor) > 0) ok("Dispatcher Staging priced the delivery");
      else bad("Dispatcher Staging priced the delivery", "the delivery fee was zero");
      // The response must carry no settlement figures.
      const leaked = Object.keys(body).filter((k) => /restaurantPayable|platformGross|processorFee|markup/i.test(k));
      if (leaked.length) bad("the quote exposes no margin", `leaked ${leaked.join(", ")}`);
      else ok("the quote exposes no margin");
    }

    // Below the minimum, and out of range, are both reachable with the seeded data.
    const small = await call("/cart/quote", {
      token: TOKEN_A, method: "POST",
      body: { restaurantSlug: "stg-the-steam-menu", addressId: home.id, lines: [{ itemId: "stg-steam-rice", quantity: 1, options: [] }] },
    });
    const smallCode = (small.json as { code?: string })?.code;
    if (smallCode === "BELOW_MINIMUM") ok("a cart under the restaurant's minimum is refused");
    else if (smallCode === "QUOTE_FAILED") skip("a cart under the restaurant's minimum is refused", "the minimum is checked after the delivery quote, which is failing");
    else if (smallCode) bad("a cart under the restaurant's minimum is refused", `refused with ${smallCode} instead`);
    else bad("a cart under the restaurant's minimum is refused", `got ${small.status} with no code`);

    if (far) {
      const r = await call("/cart/quote", {
        token: TOKEN_A, method: "POST",
        body: { restaurantSlug: "stg-trishas-kitchen", addressId: far.id, lines: [{ itemId: "stg-jollof", quantity: 1, options: [{ groupId: "protein", choiceId: "chicken" }] }] },
      });
      const code = (r.json as { code?: string })?.code;
      const serviceable = (r.json as { serviceable?: boolean })?.serviceable;
      // Serviceability is Dispatcher's answer. With Dispatcher down every
      // address is "refused", which proves nothing about range.
      if (code === "QUOTE_FAILED") skip("a delivery too far away is refused", "serviceability is Dispatcher's call, and Dispatcher is unreachable");
      else if (serviceable === false || code) ok(`a delivery too far away is refused (${code ?? "unserviceable"})`);
      else bad("a delivery too far away is refused", "it quoted successfully");
    }

    // A price the client invents must be ignored, not honoured.
    const tampered = await call("/cart/quote", {
      token: TOKEN_A, method: "POST",
      body: {
        restaurantSlug: "stg-trishas-kitchen", addressId: home.id,
        lines: [{ itemId: "stg-jollof", quantity: 1, priceMinor: 1, price: 1, options: [{ groupId: "protein", choiceId: "chicken" }] }],
      },
    });
    const tBody = tampered.json as { totalMinor?: number; serviceable?: boolean; code?: string };
    if (tBody?.serviceable) {
      if (Number(tBody.totalMinor) <= 100) bad("a client-supplied price is ignored", `the server charged ${tBody.totalMinor} minor units — THE CLIENT SET THE PRICE`);
      else ok("a client-supplied price is ignored");
    } else {
      // The quote never completed, so nothing was priced and nothing is proven.
      skip("a client-supplied price is ignored", `the quote did not complete (${tBody?.code ?? tampered.status})`);
    }

    // Options are resolved against the restaurant's own option groups, before
    // any delivery call. A client cannot invent a cheap or free upgrade.
    const badOption = await call("/cart/quote", {
      token: TOKEN_A, method: "POST",
      body: { restaurantSlug: "stg-trishas-kitchen", addressId: home.id,
              lines: [{ itemId: "stg-jollof", quantity: 1, options: [{ groupId: "protein", choiceId: "free-lobster" }] }] },
    });
    const bo = badOption.json as { serviceable?: boolean; error?: string };
    if (bo?.serviceable) bad("an invented menu option is rejected", "the quote accepted an option that does not exist");
    else if (/option/i.test(bo?.error ?? "")) ok("an invented menu option is rejected");
    else bad("an invented menu option is rejected", `refused, but for another reason: ${bo?.error}`);

    // A sold-out item must not be orderable.
    const soldOut = await call("/cart/quote", {
      token: TOKEN_A, method: "POST",
      body: { restaurantSlug: "stg-trishas-kitchen", addressId: home.id, lines: [{ itemId: "stg-soldout", quantity: 1, options: [] }] },
    });
    if ((soldOut.json as { serviceable?: boolean })?.serviceable) bad("a sold-out item cannot be ordered", "it quoted");
    else ok("a sold-out item cannot be ordered");

    // A POS-only item is not orderable through the customer API either.
    const posOnly = await call("/cart/quote", {
      token: TOKEN_A, method: "POST",
      body: { restaurantSlug: "stg-trishas-kitchen", addressId: home.id, lines: [{ itemId: "stg-staff-meal", quantity: 1, options: [] }] },
    });
    if ((posOnly.json as { serviceable?: boolean })?.serviceable) bad("a pos_only item cannot be ordered", "it quoted");
    else ok("a pos_only item cannot be ordered");
  }

  // ── 6. Checkout, up to the point a human is needed ────────────────────────
  console.log("\nCheckout");
  if (home) {
    const r = await call("/orders", {
      token: TOKEN_A, method: "POST",
      body: {
        restaurantSlug: "stg-trishas-kitchen", addressId: home.id, note: "staging smoke test",
        lines: [{ itemId: "stg-jollof", quantity: 2, options: [{ groupId: "protein", choiceId: "chicken" }] }],
      },
    });
    const body = r.json as { reference?: string; authorizationUrl?: string; amountMinor?: number; code?: string; error?: string };
    if (r.status === 200 && body.reference && body.authorizationUrl) {
      ok(`a payment intent was created (${body.reference}, ${Number(body.amountMinor) / 100} NGN)`);
      if (/^https:\/\/checkout\.paystack\.com/.test(body.authorizationUrl)) ok("Paystack TEST mode accepted the transaction");
      else bad("Paystack accepted the transaction", `unexpected authorization url: ${body.authorizationUrl}`);
      console.log(`\n  → Open this to finish the journey with a TEST card:\n    ${body.authorizationUrl}`);
      console.log("    Test card 4084 0840 8408 4081, any future expiry, CVV 408.");
      console.log("    The order document appears only when the webhook confirms the payment.");
    } else if (body.code === "NO_PHONE") {
      bad("a payment intent was created", "the staging customer has no phone number on their profile");
    } else {
      bad("a payment intent was created", `status ${r.status}: ${body.error ?? JSON.stringify(body)}`);
    }
  }

  // ── Result ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (skipped > 0) {
    console.log("\nSkipped (NOT passes — these were never exercised):");
    for (const line of results.filter((l) => l.startsWith("  –"))) console.log(line);
  }
  if (failed > 0) {
    console.log("\nFailures:");
    for (const line of results.filter((l) => l.startsWith("  ✗"))) console.log(line);
    process.exit(1);
  }
  console.log("\nStaging is wired end to end. No production system was contacted.");
}

main().catch((err) => { console.error(`\n${err.message ?? err}`); process.exit(1); });
