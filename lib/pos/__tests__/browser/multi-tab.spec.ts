/**
 * POS draft identity — multi-tab browser test (Playwright).
 *
 * Proves in a real browser that:
 *   1. two tabs ringing up different orders get different localOrderIds
 *   2. reloading a tab preserves its own id
 *   3. finishing one order does not disturb the other tab's transaction
 *   4. an offline hand-off in one tab does not alter the other's identity
 *   5. a restored draft after a browser-session restart reuses the ORIGINAL id
 *   6. the key is never kept in a browser-wide localStorage singleton
 *
 * NOT WIRED INTO CI — Playwright is not a dependency of this repo. To run:
 *
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 *   npx esbuild lib/pos/draft.ts --bundle --format=iife --global-name=PosDraft \
 *     --outfile=lib/pos/__tests__/browser/draft.bundle.js
 *   npx http-server lib/pos/__tests__/browser -p 8098 &
 *   npx playwright test lib/pos/__tests__/browser/multi-tab.spec.ts
 *
 * Override the URL with POS_HARNESS_URL if the browser cannot reach loopback
 * (see docs/POS_IDEMPOTENCY_ROLLOUT.md — that was the case in one sandbox, where
 * the machine's LAN address worked instead).
 *
 * The harness page drives the REAL lib/pos/draft.ts bundle, so this exercises
 * production identity logic. The Node-level equivalents, including the crash and
 * ambiguity paths, are in lib/pos/__tests__/draft.test.ts.
 */

import { expect, test, type Page } from "@playwright/test";

const HARNESS = process.env.POS_HARNESS_URL ?? "http://127.0.0.1:8098/multi-tab.html";

interface HarnessState {
  kind: string | null;
  localOrderId: string | null;
  draftId: string | null;
  candidates?: string[];
  ownedDraftId: string | null;
  hasCart: boolean;
  durableDraftCount: number;
  durableKeys: string[];
  queuedKeys: string[];
}

const state = (page: Page): Promise<HarnessState> =>
  page.evaluate(() => JSON.parse(document.getElementById("state")!.textContent!));

const act = async (page: Page, id: string) => {
  await page.click(`#${id}`);
};

test("two tabs ringing up different orders never share one localOrderId", async ({ browser }) => {
  // One context = one profile, one origin, shared localStorage — exactly the
  // situation a browser-wide key would break.
  const context = await browser.newContext();
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto(HARNESS);
  await tabB.goto(HARNESS);

  await act(tabA, "set-cart");
  await act(tabA, "mount");
  await act(tabB, "mount");

  const a = await state(tabA);
  const b = await state(tabB);

  expect(a.localOrderId).toBeTruthy();
  expect(b.localOrderId).toBeTruthy();
  expect(a.localOrderId).not.toBe(b.localOrderId);
  expect(a.ownedDraftId).not.toBe(b.ownedDraftId);
  expect(a.durableDraftCount).toBe(2);

  // Reload each: every tab keeps its own identity.
  await tabA.reload();
  await tabB.reload();
  expect((await state(tabA)).localOrderId).toBe(a.localOrderId);
  expect((await state(tabB)).localOrderId).toBe(b.localOrderId);

  // The key must never sit in a browser-wide localStorage slot.
  expect(await tabA.evaluate(() => localStorage.getItem("rf_pos_txn_id"))).toBeNull();

  await context.close();
});

test("an offline hand-off in one tab leaves the other tab's transaction alone", async ({ browser }) => {
  const context = await browser.newContext();
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto(HARNESS);
  await tabB.goto(HARNESS);

  await act(tabA, "set-cart");
  await act(tabA, "mount");
  await act(tabB, "mount");
  const aKey = (await state(tabA)).localOrderId!;
  const bKey = (await state(tabB)).localOrderId!;

  // A's order goes to the offline queue: the queue record takes its own copy of
  // the key and only A's draft is retired.
  await act(tabA, "handoff");
  const afterA = await state(tabA);
  expect(afterA.queuedKeys).toContain(aKey);
  expect(afterA.durableKeys).toEqual([bKey]);

  // B is untouched, and still uses its own key.
  await act(tabB, "mount");
  const afterB = await state(tabB);
  expect(afterB.kind).toBe("existing");
  expect(afterB.localOrderId).toBe(bKey);

  // A's next order gets a NEW identity, and the queued one is unchanged.
  await act(tabA, "set-cart");
  await act(tabA, "mount");
  const nextA = await state(tabA);
  expect(nextA.kind).toBe("created");
  expect(nextA.localOrderId).not.toBe(aKey);
  expect(nextA.queuedKeys).toContain(aKey);

  await context.close();
});

test("a restored draft after a browser-session restart reuses the original id", async ({ browser }) => {
  const context = await browser.newContext();
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto(HARNESS);
  await tabB.goto(HARNESS);

  await act(tabA, "set-cart");
  await act(tabA, "mount");
  await act(tabB, "mount");
  const original = (await state(tabA)).localOrderId!;
  const bKey = (await state(tabB)).localOrderId!;

  // The order was submitted, the server committed it, the acknowledgement was
  // lost, and the browser closed before the queue hand-off. pagehide released the
  // draft; the new session has no sessionStorage.
  await act(tabA, "release");
  await act(tabA, "new-session");
  await act(tabA, "mount");

  const recovered = await state(tabA);
  expect(recovered.kind).toBe("adopted");
  expect(recovered.localOrderId).toBe(original);
  // Crucially, it recovered its OWN draft and not the live tab's.
  expect(recovered.localOrderId).not.toBe(bKey);

  await act(tabB, "mount");
  expect((await state(tabB)).localOrderId).toBe(bKey);

  await context.close();
});
