/**
 * Favourites: ownership, idempotency and isolation.
 *
 * The store functions run against a small in-memory Firestore double, so the
 * real add/remove/list logic executes. The route-level guarantees (auth,
 * identity from the token) are asserted structurally over the real source,
 * because those live in the wrapper rather than in these functions.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addFavourite, removeFavourite, isFavourited, listFavouriteSlugs, FAVOURITES,
} from "../favourites";

let passed = 0;
const test = (n: string, f: () => Promise<void> | void) => Promise.resolve(f()).then(() => { passed++; console.log(`  ✓ ${n}`); });

/** Minimal Firestore double: only the paths favourites actually walks. */
function fakeDb() {
  const data = new Map<string, Record<string, unknown>>();
  const key = (uid: string, slug: string) => `customers/${uid}/${FAVOURITES}/${slug}`;
  const mk = (uid: string) => ({
    doc: (slug: string) => ({
      set: async (v: Record<string, unknown>) => { data.set(key(uid, slug), v); },
      delete: async () => { data.delete(key(uid, slug)); },
      get: async () => ({ exists: data.has(key(uid, slug)) }),
    }),
    orderBy: () => ({ limit: () => ({ get: async () => ({
      docs: [...data.keys()].filter(k => k.startsWith(`customers/${uid}/`))
        .map(k => ({ id: k.split("/").pop()! })),
    }) }) }),
  });
  return {
    _data: data,
    collection: (c: string) => ({
      doc: (uid: string) => ({ collection: (_: string) => mk(uid) }),
      _c: c,
    }),
  } as never;
}

async function main() {
  console.log("marketplace/favourites");
  const A = "cust-A", B = "cust-B";

  await test("[1] add then list", async () => {
    const db = fakeDb();
    await addFavourite(db, A, "stg-trishas-kitchen", 1);
    assert.deepEqual(await listFavouriteSlugs(db, A), ["stg-trishas-kitchen"]);
  });

  await test("[2] repeated add is idempotent — one entry, not two", async () => {
    const db = fakeDb();
    await addFavourite(db, A, "stg-trishas-kitchen", 1);
    await addFavourite(db, A, "stg-trishas-kitchen", 2);
    await addFavourite(db, A, "stg-trishas-kitchen", 3);
    assert.deepEqual(await listFavouriteSlugs(db, A), ["stg-trishas-kitchen"]);
  });

  await test("[3] remove", async () => {
    const db = fakeDb();
    await addFavourite(db, A, "stg-trishas-kitchen", 1);
    await removeFavourite(db, A, "stg-trishas-kitchen");
    assert.deepEqual(await listFavouriteSlugs(db, A), []);
  });

  await test("[4] repeated remove is not an error", async () => {
    const db = fakeDb();
    await removeFavourite(db, A, "never-favourited");
    await removeFavourite(db, A, "never-favourited");
    assert.equal(await isFavourited(db, A, "never-favourited"), false);
  });

  await test("[5] isFavourited reflects state both ways", async () => {
    const db = fakeDb();
    assert.equal(await isFavourited(db, A, "x"), false);
    await addFavourite(db, A, "x", 1);
    assert.equal(await isFavourited(db, A, "x"), true);
    await removeFavourite(db, A, "x");
    assert.equal(await isFavourited(db, A, "x"), false);
  });

  await test("[6] CUSTOMER ISOLATION — B's favourite is invisible to A", async () => {
    const db = fakeDb();
    await addFavourite(db, B, "stg-the-steam-menu", 1);
    assert.deepEqual(await listFavouriteSlugs(db, A), []);
    assert.equal(await isFavourited(db, A, "stg-the-steam-menu"), false);
    assert.equal(await isFavourited(db, B, "stg-the-steam-menu"), true);
  });

  await test("[7] A removing does not touch B's identical favourite", async () => {
    const db = fakeDb();
    await addFavourite(db, A, "shared-slug", 1);
    await addFavourite(db, B, "shared-slug", 1);
    await removeFavourite(db, A, "shared-slug");
    assert.equal(await isFavourited(db, A, "shared-slug"), false);
    assert.equal(await isFavourited(db, B, "shared-slug"), true, "A's delete reached B");
  });

  // ── Route-level guarantees, asserted over the real source ────────────────
  const ROOT = join(__dirname, "..", "..", "..");
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const LIST = code(readFileSync(join(ROOT, "app/api/mobile/v1/me/favourites/route.ts"), "utf8"));
  const ONE = code(readFileSync(join(ROOT, "app/api/mobile/v1/me/favourites/[slug]/route.ts"), "utf8"));

  await test("[8] every favourites route requires authentication", () => {
    for (const [name, src] of [["list/toggle", LIST], ["[slug]", ONE]] as const) {
      assert.match(src, /withCustomer/, `${name} is not behind withCustomer`);
      assert.ok(!/withPublic/.test(src), `${name} is public`);
    }
  });

  await test("[9] identity comes from the token, never the request", () => {
    for (const src of [LIST, ONE]) {
      assert.match(src, /customer\.id/);
      assert.ok(!/body\.customerId|searchParams\.get\(["']customerId/.test(src),
        "a caller-supplied customer id would be an IDOR");
    }
  });

  await test("[10] an invalid restaurant cannot be favourited", () => {
    assert.match(LIST, /isFavouritableRestaurant/);
    assert.match(LIST, /RESTAURANT_UNAVAILABLE/);
    // ...but removing one must still work, or a customer whose favourite left
    // the marketplace could never clear it. Check CONTROL FLOW, not raw source
    // order: the import list mentions both names and says nothing about order.
    const body = LIST.slice(LIST.indexOf("export const POST"));
    const alreadyBranch = body.slice(body.indexOf("if (already)"), body.indexOf("isFavouritableRestaurant"));
    assert.match(alreadyBranch, /removeFavourite/, "removal is not inside the already-favourited branch");
    assert.match(alreadyBranch, /return \{ favourited: false \}/, "the remove branch must return before the availability check");
  });

  console.log(`\n${passed} checks passed\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
