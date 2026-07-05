/**
 * Restaurant Operating Profile tests (fake Firestore; deterministic).
 * Proves the profile is a restaurant-scoped INPUT that never changes engine judgement:
 *  - defaults are a no-op (identity application),
 *  - edits are versioned + audited; learned prefs are resettable,
 *  - gradual learning folds accept/dismiss decisions in transparently,
 *  - APPLICATION is pure: confidence threshold hides recs, a price cap drops over-cap
 *    price increases, "prefer promotions" demotes price increases,
 *  - narration directive is empty by default,
 *  - tenant isolation + write-safety (only ai_operating_profile* written; no core writes).
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import {
  getOperatingProfile,
  updateOperatingProfile,
  resetLearnedPreferences,
  learnFromDecision,
  listProfileAudit,
  applyProfileToRecommendations,
  profileNarrationDirective,
  AI_OPERATING_PROFILE_COLLECTION,
  AI_OPERATING_PROFILE_AUDIT_COLLECTION,
} from "../profile";
import type { ActorRef, Recommendation } from "../types";

const CORE = ["restaurants", "orders", "payments", "menu_items", "prepared_items", "users"];
const now = () => new Date("2026-07-08T12:00:00Z");
const owner: ActorRef = { type: "owner", id: "u-owner" };

let passed = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
function asDb(db: FakeFirestore) {
  return db as unknown as FirebaseFirestore.Firestore;
}

function rec(partial: Partial<Recommendation>): Recommendation {
  return {
    id: partial.id ?? "x",
    restaurantId: "grills",
    dateKey: "2026-07-08",
    type: partial.type ?? "staffing",
    category: "staff",
    title: partial.title ?? "t",
    rationale: "r",
    expectedImpact: "i",
    action: partial.action ?? { kind: partial.type ?? "staffing" },
    confidence: partial.confidence ?? 0.8,
    confidenceLevel: "High",
    priority: partial.priority ?? 50,
    status: "new",
    timeWindow: { label: "week", from: "", to: "" },
    generatedAt: "",
    updatedAt: "",
    source: "deterministic",
    version: 1,
  } as Recommendation;
}

async function main() {
  console.log("\n[Profile] Restaurant Operating Profile\n");

  // ── Defaults are a no-op input ────────────────────────────────────────────
  await ok("a fresh profile returns defaults and reads write nothing", async () => {
    const db = new FakeFirestore();
    const p = await getOperatingProfile("grills", { db: asDb(db), now });
    assert.equal(p.version, 0);
    assert.equal(p.ai.confidenceThreshold, 0);
    assert.equal(p.business.maxPriceIncreaseNaira, null);
    assert.equal(p.learned.length, 0);
    assert.equal(db.writes.length, 0, "reads must not write");
  });

  await ok("default profile applied to recommendations is identity", async () => {
    const db = new FakeFirestore();
    const p = await getOperatingProfile("grills", { db: asDb(db), now });
    const recs = [rec({ id: "a", type: "price_increase", action: { kind: "price_increase", target: "Jollof", delta: 500 }, priority: 80 }), rec({ id: "b", type: "staffing", priority: 70 })];
    assert.deepEqual(applyProfileToRecommendations(recs, p).map((r) => r.id), ["a", "b"]);
  });

  await ok("default narration directive is empty (behaviour unchanged)", async () => {
    const db = new FakeFirestore();
    const p = await getOperatingProfile("grills", { db: asDb(db), now });
    assert.equal(profileNarrationDirective(p), "");
  });

  // ── Edits: versioned + audited ────────────────────────────────────────────
  await ok("editing a section bumps the version and writes an audit entry", async () => {
    const db = new FakeFirestore();
    const p1 = await updateOperatingProfile("grills", { business: { maxPriceIncreaseNaira: 300 } }, owner, { db: asDb(db), now });
    assert.equal(p1.version, 1);
    assert.equal(p1.business.maxPriceIncreaseNaira, 300);
    assert.equal(p1.updatedBy?.id, owner.id);

    const p2 = await updateOperatingProfile("grills", { owner: { responseStyle: "concise" } }, owner, { db: asDb(db), now });
    assert.equal(p2.version, 2);
    assert.equal(p2.business.maxPriceIncreaseNaira, 300, "prior edits preserved");
    assert.equal(p2.owner.responseStyle, "concise");

    const audit = await listProfileAudit("grills", { db: asDb(db), now });
    assert.equal(audit.length, 2);
    assert.equal(audit[0].version, 2); // newest first
    assert.ok(audit[0].changedKeys.includes("owner.responseStyle"));
  });

  // ── Application is a pure, deterministic input ────────────────────────────
  await ok("price cap drops over-cap price increases; keeps the rest", async () => {
    const db = new FakeFirestore();
    await updateOperatingProfile("grills", { business: { maxPriceIncreaseNaira: 300 } }, owner, { db: asDb(db), now });
    const p = await getOperatingProfile("grills", { db: asDb(db), now });
    const recs = [
      rec({ id: "big", type: "price_increase", action: { kind: "price_increase", target: "Jollof", delta: 500 } }),
      rec({ id: "ok", type: "price_increase", action: { kind: "price_increase", target: "Suya", delta: 200 } }),
      rec({ id: "staff", type: "staffing" }),
    ];
    const out = applyProfileToRecommendations(recs, p).map((r) => r.id);
    assert.ok(!out.includes("big"), "over-cap price increase removed");
    assert.ok(out.includes("ok") && out.includes("staff"));
  });

  await ok("confidence threshold hides low-confidence recommendations", async () => {
    const db = new FakeFirestore();
    await updateOperatingProfile("grills", { ai: { confidenceThreshold: 0.7 } }, owner, { db: asDb(db), now });
    const p = await getOperatingProfile("grills", { db: asDb(db), now });
    const recs = [rec({ id: "hi", confidence: 0.9 }), rec({ id: "lo", confidence: 0.5 })];
    assert.deepEqual(applyProfileToRecommendations(recs, p).map((r) => r.id), ["hi"]);
  });

  await ok('"prefer promotions" demotes price increases below promotions', async () => {
    const db = new FakeFirestore();
    await updateOperatingProfile("grills", { business: { preferPromotionsOverPriceIncrease: true } }, owner, { db: asDb(db), now });
    const p = await getOperatingProfile("grills", { db: asDb(db), now });
    const recs = [
      rec({ id: "price", type: "price_increase", action: { kind: "price_increase", delta: 100 } }),
      rec({ id: "staff", type: "staffing" }),
      rec({ id: "promo", type: "promote_item" }),
    ];
    const order = applyProfileToRecommendations(recs, p).map((r) => r.id);
    assert.equal(order[0], "promo", "promotion first");
    assert.equal(order[order.length - 1], "price", "price increase last");
  });

  await ok("concise style yields a narration directive", async () => {
    const db = new FakeFirestore();
    await updateOperatingProfile("grills", { owner: { responseStyle: "concise" } }, owner, { db: asDb(db), now });
    const p = await getOperatingProfile("grills", { db: asDb(db), now });
    assert.ok(/brief/i.test(profileNarrationDirective(p)));
  });

  // ── Learned preferences: transparent, gradual, resettable ─────────────────
  await ok("gradual learning activates a pattern after enough decisions", async () => {
    const db = new FakeFirestore();
    await learnFromDecision("grills", "price_increase", "dismissed", owner, { db: asDb(db), now });
    let p = await getOperatingProfile("grills", { db: asDb(db), now });
    let learned = p.learned.find((l) => l.subject === "price_increase");
    assert.ok(learned && !learned.active, "one decision → not yet active");

    await learnFromDecision("grills", "price_increase", "dismissed", owner, { db: asDb(db), now });
    p = await getOperatingProfile("grills", { db: asDb(db), now });
    learned = p.learned.find((l) => l.subject === "price_increase");
    assert.ok(learned && learned.active, "two decisions → active");
    assert.ok(/reject/i.test(learned!.statement), "transparent human statement");
  });

  await ok("learned preferences are resettable and audited", async () => {
    const db = new FakeFirestore();
    await learnFromDecision("grills", "staffing", "accepted", owner, { db: asDb(db), now });
    const cleared = await resetLearnedPreferences("grills", owner, { db: asDb(db), now });
    assert.equal(cleared.learned.length, 0);
    const audit = await listProfileAudit("grills", { db: asDb(db), now });
    assert.ok(audit.some((a) => a.section === "reset_learned"));
  });

  // ── Tenant isolation + write-safety ───────────────────────────────────────
  await ok("profile is tenant-scoped", async () => {
    const db = new FakeFirestore();
    await updateOperatingProfile("grills", { business: { openingHours: "9-10" } }, owner, { db: asDb(db), now });
    const other = await getOperatingProfile("other", { db: asDb(db), now });
    assert.equal(other.business.openingHours, null, "no cross-tenant bleed");
    assert.equal(other.version, 0);
  });

  await ok("writes ONLY ai_operating_profile* (never core)", async () => {
    const db = new FakeFirestore();
    await updateOperatingProfile("grills", { ai: { automationLevel: "auto" } }, owner, { db: asDb(db), now });
    await learnFromDecision("grills", "staffing", "accepted", owner, { db: asDb(db), now });
    await resetLearnedPreferences("grills", owner, { db: asDb(db), now });
    for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
    for (const c of db.writtenCollections()) {
      assert.ok([AI_OPERATING_PROFILE_COLLECTION, AI_OPERATING_PROFILE_AUDIT_COLLECTION].includes(c), `unexpected collection written: ${c}`);
    }
  });

  console.log(`\n✅ ALL ${passed} PROFILE CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ PROFILE TEST FAILED\n", err);
  process.exit(1);
});
