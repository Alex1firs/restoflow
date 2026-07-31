/**
 * Fix 4 — cross-tab queue ownership, in a real browser against REAL IndexedDB.
 *
 * Run: npm run test:pos:browser:build && npm run test:pos:browser
 *
 * The Node suite (lib/pos/__tests__/sync-lease.test.ts) models IndexedDB's
 * atomicity. This proves it against the real thing: two pages in one browser
 * context share one origin and therefore one database, exactly like two POS tabs
 * or an installed PWA window plus a browser tab.
 */

import { expect, test, type Page } from "@playwright/test";

const HARNESS = "/queue-lease.html";

interface HarnessState {
  ownerId: string;
  total: number;
  outstanding: number;
  claimable: string[];
  records: Array<{ id: string; status: string; owner: string | null; attempts: number; customPrice: number }>;
  log: unknown[];
}

const state = (page: Page): Promise<HarnessState> =>
  page.evaluate(() => JSON.parse(document.getElementById("state")!.textContent!));

const act = async (page: Page, id: string) => {
  await page.click(`#${id}`);
  // The handlers are async; wait for the rendered state to settle.
  await page.waitForTimeout(250);
};

async function openTwoTabs(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext();
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto(HARNESS);
  await tabB.goto(HARNESS);
  await act(tabA, "wipe");
  await tabB.reload();
  return { context, tabA, tabB };
}

test("two tabs syncing at once: every record is claimed by exactly one tab", async ({ browser }) => {
  const { context, tabA, tabB } = await openTwoTabs(browser);

  await act(tabA, "seed");
  await tabB.reload();

  const before = await state(tabA);
  expect(before.total).toBe(5);
  expect((await state(tabA)).ownerId).not.toBe((await state(tabB)).ownerId);

  // Genuinely concurrent: both tabs start their run without awaiting each other.
  await Promise.all([tabA.click("#claim-all"), tabB.click("#claim-all")]);
  await tabA.waitForTimeout(1500);

  const claimedA: string[] = await tabA.evaluate(() => (window as never as { __CLAIMED__?: string[] }).__CLAIMED__ ?? []);
  const claimedB: string[] = await tabB.evaluate(() => (window as never as { __CLAIMED__?: string[] }).__CLAIMED__ ?? []);

  const all = [...claimedA, ...claimedB];
  // The real guarantee: no record was claimed twice, and none was dropped.
  expect(new Set(all).size).toBe(all.length);
  expect([...all].sort()).toEqual(["txn-1", "txn-2", "txn-3", "txn-4", "txn-5"]);

  await tabA.reload();
  expect((await state(tabA)).total).toBe(0);

  await context.close();
});

test("a tab does not touch a record another tab is actively holding", async ({ browser }) => {
  const { context, tabA, tabB } = await openTwoTabs(browser);
  await act(tabA, "seed");
  await tabB.reload();

  // A claims one record and holds it, as if its request were in flight.
  await act(tabA, "claim-hold");
  const held = (await state(tabA)).records.find((r) => r.status === "syncing");
  expect(held).toBeTruthy();
  expect(held!.owner).toBe((await state(tabA)).ownerId);

  // B must skip it and take only the other four.
  await act(tabB, "claim-all");
  const claimedB: string[] = await tabB.evaluate(() => (window as never as { __CLAIMED__?: string[] }).__CLAIMED__ ?? []);
  expect(claimedB).not.toContain(held!.id);
  expect(claimedB).toHaveLength(4);

  // A's record survives, still owned by A.
  await tabA.reload();
  const after = await state(tabA);
  expect(after.records.map((r) => r.id)).toEqual([held!.id]);
  expect(after.records[0].status).toBe("syncing");

  await context.close();
});

test("a held record still counts as outstanding once its lease lapses, and recovers", async ({ browser }) => {
  const { context, tabA, tabB } = await openTwoTabs(browser);
  await act(tabA, "seed");
  await act(tabA, "claim-hold");

  // While the lease is live the record is in progress, not outstanding.
  const held = (await state(tabA)).records.find((r) => r.status === "syncing")!;
  expect((await state(tabA)).claimable).not.toContain(held.id);

  // Simulate the owner dying long ago by rewinding the lease in the database.
  await tabB.evaluate(async (id) => {
    const Q = (window as never as { PosQueue: Record<string, (...a: unknown[]) => unknown> }).PosQueue;
    await (Q.dbUpdateAtomic as (s: string, k: string, u: (c: Record<string, unknown> | undefined) => unknown) => Promise<unknown>)(
      "ordersQueue",
      id,
      (cur) => (cur ? { ...cur, leaseExpiresAt: 1 } : null)
    );
  }, held.id);

  await tabB.reload();
  const stranded = await state(tabB);
  // The lost-order bug: a stranded record used to vanish from every count.
  expect(stranded.claimable).toContain(held.id);
  expect(stranded.outstanding).toBeGreaterThan(0);

  // Recovery returns it to a retryable state, preserving identity and custom price.
  await act(tabB, "recover");
  const recovered = (await state(tabB)).records.find((r) => r.id === held.id)!;
  expect(recovered.status).toBe("failed");
  expect(recovered.owner).toBeNull();
  expect(recovered.customPrice).toBe(4500);
  expect(recovered.id).toBe(held.id);

  await context.close();
});

test("completing records in one tab does not disturb the other tab's queue view", async ({ browser }) => {
  const { context, tabA, tabB } = await openTwoTabs(browser);
  await act(tabA, "seed");
  await tabB.reload();
  expect((await state(tabB)).total).toBe(5);

  await act(tabA, "claim-all");
  expect((await state(tabA)).total).toBe(0);

  // B refreshes and simply sees the drained queue — no error, no duplicate work.
  await act(tabB, "refresh");
  const b = await state(tabB);
  expect(b.total).toBe(0);
  expect(b.claimable).toEqual([]);

  await context.close();
});
