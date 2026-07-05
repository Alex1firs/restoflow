/**
 * AI Automation tests (fake Firestore; deterministic — no LLM).
 * Proves the Phase 6 invariants:
 *  - CONSUMES approved sources: an automation is created only from an ACCEPTED
 *    recommendation (or a HIGH purchasing line); a non-accepted rec is refused.
 *  - APPROVAL-FIRST execution: with no enabled rule, execution is refused and NO
 *    execution record is written.
 *  - FULL AUDIT: executions record actor, timestamps, status, attempts, error, rollback.
 *  - RETRIES: a flaky handler that fails once then succeeds → status succeeded, attempt 2.
 *  - FAILURE + UNKNOWN handler recorded; automation moves to "failed".
 *  - ROLLBACK: a reversible handler can be reversed; the audit trail captures it.
 *  - TENANT isolation and write-safety (only ai_automation_* + ai_usage; no core writes).
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import {
  createAutomationFromRecommendation,
  createAutomationFromPurchasingLine,
  executeAutomation,
  rollbackExecution,
  setAutomationRule,
  getAutomationRule,
  listExecutions,
  AutomationDisabledError,
  AutomationNotApprovedError,
  AutomationStateError,
  AI_AUTOMATIONS_COLLECTION,
  AI_AUTOMATION_RULES_COLLECTION,
  AI_AUTOMATION_EXECUTIONS_COLLECTION,
  type ActionHandler,
} from "../automation";
import { AI_USAGE_COLLECTION } from "../usage";
import type { ActorRef } from "../types";

const CORE = ["restaurants", "orders", "payments", "menu_items", "prepared_items", "users"];
const AI_ONLY = [AI_AUTOMATIONS_COLLECTION, AI_AUTOMATION_RULES_COLLECTION, AI_AUTOMATION_EXECUTIONS_COLLECTION, AI_USAGE_COLLECTION];
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

/** Seed approved/unapproved recommendations and a purchasing plan directly (no engine run). */
function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  // An ACCEPTED recommendation → can be automated.
  db.seed("ai_recommendations", "grills:reenable_item:fish-pepper-soup", {
    id: "reenable_item:fish-pepper-soup", restaurantId: "grills", type: "reenable_item",
    title: "Restock and re-enable Fish Pepper Soup", rationale: "It's unavailable.",
    expectedImpact: "Recover lost sales", action: { kind: "reenable_item", target: "Fish Pepper Soup" },
    status: "accepted", confidenceLevel: "Very High", priority: 90,
  });
  // A NON-accepted recommendation → must NOT be automatable.
  db.seed("ai_recommendations", "grills:price_increase:jollof-rice", {
    id: "price_increase:jollof-rice", restaurantId: "grills", type: "price_increase",
    title: "Increase the price of Jollof Rice by ₦200", expectedImpact: "More revenue",
    action: { kind: "price_increase", target: "Jollof Rice" }, status: "new",
  });
  // Today's purchasing plan with a HIGH restock line.
  db.seed("ai_purchase_plans", "grills:2026-07-08", {
    restaurantId: "grills", dateKey: "2026-07-08",
    menuDemand: [
      { item: "Fish Pepper Soup", expectedUnits: 0, expectedUnitsPerDay: 0, preparationBatches: 0, peakWindow: null, reorderSignal: "HIGH", guidance: "restock", trendPct: null, relatedRecommendationIds: [] },
      { item: "Jollof Rice", expectedUnits: 40, expectedUnitsPerDay: 6, preparationBatches: 1, peakWindow: "19:00-21:00", reorderSignal: "MEDIUM", guidance: "steady", trendPct: 10, relatedRecommendationIds: [] },
    ],
  });
  // Foreign tenant rec — isolation probe.
  db.seed("ai_recommendations", "other:reenable_item:pizza", {
    id: "reenable_item:pizza", restaurantId: "other", type: "reenable_item",
    title: "Restock Pizza", expectedImpact: "x", action: { kind: "reenable_item", target: "Pizza" }, status: "accepted",
  });
  return db;
}

async function main() {
  console.log("\n[Automation] AI Automation\n");

  // ── Approval-first CREATION ───────────────────────────────────────────────
  await ok("refuses to automate a non-accepted recommendation", async () => {
    const db = seedDb();
    await assert.rejects(
      () => createAutomationFromRecommendation("grills", "price_increase:jollof-rice", owner, { db: asDb(db), now }),
      AutomationNotApprovedError
    );
    // Nothing was created.
    assert.equal(db.writes.filter((w) => w.collection === AI_AUTOMATIONS_COLLECTION).length, 0);
  });

  await ok("creates an automation from an ACCEPTED recommendation (approved, notify)", async () => {
    const db = seedDb();
    const a = await createAutomationFromRecommendation("grills", "reenable_item:fish-pepper-soup", owner, { db: asDb(db), now });
    assert.equal(a.status, "approved");
    assert.equal(a.handlerKind, "notify");
    assert.equal(a.source.type, "recommendation");
    assert.equal(a.source.id, "reenable_item:fish-pepper-soup"); // provenance to the source rec
    assert.equal(a.createdBy.id, owner.id);
    assert.ok(a.approvedAt);
  });

  // ── Approval-first EXECUTION gate ─────────────────────────────────────────
  await ok("refuses execution when no rule is enabled (and writes NO execution record)", async () => {
    const db = seedDb();
    const a = await createAutomationFromRecommendation("grills", "reenable_item:fish-pepper-soup", owner, { db: asDb(db), now });
    // Rule defaults to disabled.
    const rule = await getAutomationRule("grills", "notify", { db: asDb(db), now });
    assert.equal(rule.enabled, false);
    await assert.rejects(() => executeAutomation("grills", a.id, owner, { db: asDb(db), now }), AutomationDisabledError);
    assert.equal(db.writes.filter((w) => w.collection === AI_AUTOMATION_EXECUTIONS_COLLECTION).length, 0);
  });

  // ── Successful execution + full audit ─────────────────────────────────────
  await ok("executes once the owner enables the rule, with a full audit record", async () => {
    const db = seedDb();
    const a = await createAutomationFromRecommendation("grills", "reenable_item:fish-pepper-soup", owner, { db: asDb(db), now });
    await setAutomationRule("grills", "notify", { enabled: true }, owner, { db: asDb(db), now });

    const { automation, execution } = await executeAutomation("grills", a.id, owner, { db: asDb(db), now });
    assert.equal(automation.status, "succeeded");
    assert.equal(automation.lastExecutionId, execution.id);
    // Audit completeness:
    assert.equal(execution.status, "succeeded");
    assert.equal(execution.actor.id, owner.id);
    assert.ok(execution.startedAt && execution.finishedAt, "timestamps recorded");
    assert.ok(execution.attempt >= 1 && execution.maxAttempts >= execution.attempt);
    assert.equal(execution.handlerKind, "notify");
    assert.ok(execution.result && /Notification queued/.test(execution.result.detail));
    assert.equal(execution.error, null);

    const audit = await listExecutions("grills", { db: asDb(db), now, automationId: a.id });
    assert.equal(audit.length, 1);
  });

  // ── Retries ───────────────────────────────────────────────────────────────
  await ok("retries a flaky handler: fail once → succeed, attempt = 2", async () => {
    const db = seedDb();
    db.seed(AI_AUTOMATIONS_COLLECTION, "grills:test-flaky", {
      id: "test-flaky", restaurantId: "grills", handlerKind: "flaky", status: "approved",
      source: { type: "recommendation", id: "x", actionKind: "x" }, action: { kind: "flaky", summary: "s", params: {} },
      title: "t", createdBy: owner, createdAt: now().toISOString(), approvedBy: owner, approvedAt: now().toISOString(), updatedAt: now().toISOString(), lastExecutionId: null, version: 1,
    });
    await setAutomationRule("grills", "flaky", { enabled: true }, owner, { db: asDb(db), now });

    let calls = 0;
    const flaky: ActionHandler = {
      kind: "flaky", reversible: false, mutatesCore: false,
      validate: () => ({ ok: true }),
      execute: async () => {
        calls++;
        if (calls === 1) throw new Error("transient");
        return { ok: true, detail: "recovered" };
      },
    };
    const { execution } = await executeAutomation("grills", "test-flaky", owner, { db: asDb(db), now, handlers: [flaky] });
    assert.equal(execution.status, "succeeded");
    assert.equal(execution.attempt, 2);
  });

  // ── Failure recorded ────────────────────────────────────────────────────────
  await ok("records a hard failure with error info; automation → failed", async () => {
    const db = seedDb();
    db.seed(AI_AUTOMATIONS_COLLECTION, "grills:test-boom", {
      id: "test-boom", restaurantId: "grills", handlerKind: "boom", status: "approved",
      source: { type: "recommendation", id: "x", actionKind: "x" }, action: { kind: "boom", summary: "s", params: {} },
      title: "t", createdBy: owner, createdAt: now().toISOString(), approvedBy: owner, approvedAt: now().toISOString(), updatedAt: now().toISOString(), lastExecutionId: null, version: 1,
    });
    await setAutomationRule("grills", "boom", { enabled: true }, owner, { db: asDb(db), now });
    const boom: ActionHandler = {
      kind: "boom", reversible: false, mutatesCore: false,
      validate: () => ({ ok: true }),
      execute: async () => { throw new Error("integration down"); },
    };
    const { automation, execution } = await executeAutomation("grills", "test-boom", owner, { db: asDb(db), now, handlers: [boom] });
    assert.equal(execution.status, "failed");
    assert.equal(execution.attempt, 2); // exhausted retries
    assert.ok(execution.error && /integration down/.test(execution.error.message));
    assert.equal(automation.status, "failed");
  });

  await ok("records failure for an unknown handler kind", async () => {
    const db = seedDb();
    db.seed(AI_AUTOMATIONS_COLLECTION, "grills:test-ghost", {
      id: "test-ghost", restaurantId: "grills", handlerKind: "ghost", status: "approved",
      source: { type: "recommendation", id: "x", actionKind: "x" }, action: { kind: "ghost", summary: "s", params: {} },
      title: "t", createdBy: owner, createdAt: now().toISOString(), approvedBy: owner, approvedAt: now().toISOString(), updatedAt: now().toISOString(), lastExecutionId: null, version: 1,
    });
    await setAutomationRule("grills", "ghost", { enabled: true }, owner, { db: asDb(db), now });
    const { execution } = await executeAutomation("grills", "test-ghost", owner, { db: asDb(db), now });
    assert.equal(execution.status, "failed");
    assert.ok(execution.error && /No handler/.test(execution.error.message));
  });

  // ── Rollback ──────────────────────────────────────────────────────────────
  await ok("executes and then rolls back a reversible purchasing automation", async () => {
    const db = seedDb();
    const a = await createAutomationFromPurchasingLine("grills", "Fish Pepper Soup", owner, { db: asDb(db), now });
    assert.equal(a.handlerKind, "purchase_order_draft");
    await setAutomationRule("grills", "purchase_order_draft", { enabled: true }, owner, { db: asDb(db), now });

    const { execution } = await executeAutomation("grills", a.id, owner, { db: asDb(db), now });
    assert.equal(execution.status, "succeeded");
    assert.ok(execution.rollbackToken, "reversible handler returns a rollback token");

    const rolledBack = await rollbackExecution("grills", execution.id, owner, { db: asDb(db), now });
    assert.ok(rolledBack.rollback && rolledBack.rollback.by.id === owner.id);
    assert.ok(/discarded/i.test(rolledBack.rollback!.detail));
  });

  await ok("refuses to create a purchasing automation from a non-HIGH line", async () => {
    const db = seedDb();
    await assert.rejects(
      () => createAutomationFromPurchasingLine("grills", "Jollof Rice", owner, { db: asDb(db), now }),
      AutomationStateError
    );
  });

  await ok("refuses to roll back a non-reversible (notify) execution", async () => {
    const db = seedDb();
    const a = await createAutomationFromRecommendation("grills", "reenable_item:fish-pepper-soup", owner, { db: asDb(db), now });
    await setAutomationRule("grills", "notify", { enabled: true }, owner, { db: asDb(db), now });
    const { execution } = await executeAutomation("grills", a.id, owner, { db: asDb(db), now });
    await assert.rejects(() => rollbackExecution("grills", execution.id, owner, { db: asDb(db), now }), AutomationStateError);
  });

  // ── Tenant isolation ────────────────────────────────────────────────────────
  await ok("cannot create an automation from another tenant's recommendation", async () => {
    const db = seedDb();
    // grills' rec id doesn't exist under "other" → not found.
    await assert.rejects(
      () => createAutomationFromRecommendation("other", "reenable_item:fish-pepper-soup", { type: "owner", id: "u2" }, { db: asDb(db), now }),
      AutomationStateError
    );
  });

  await ok("cannot execute an automation that belongs to another tenant", async () => {
    const db = seedDb();
    const a = await createAutomationFromRecommendation("grills", "reenable_item:fish-pepper-soup", owner, { db: asDb(db), now });
    await setAutomationRule("other", "notify", { enabled: true }, { type: "owner", id: "u2" }, { db: asDb(db), now });
    // "other" tries to run grills' automation id → stored under grills only → not found.
    await assert.rejects(() => executeAutomation("other", a.id, { type: "owner", id: "u2" }, { db: asDb(db), now }), AutomationStateError);
  });

  // ── Write-safety ─────────────────────────────────────────────────────────────
  await ok("writes ONLY ai_automation_* + ai_usage (never core collections)", async () => {
    const db = seedDb();
    const a = await createAutomationFromRecommendation("grills", "reenable_item:fish-pepper-soup", owner, { db: asDb(db), now });
    await setAutomationRule("grills", "notify", { enabled: true }, owner, { db: asDb(db), now });
    await executeAutomation("grills", a.id, owner, { db: asDb(db), now });

    for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
    for (const c of db.writtenCollections()) {
      assert.ok(AI_ONLY.includes(c), `unexpected collection written: ${c}`);
    }
  });

  console.log(`\n✅ ALL ${passed} AUTOMATION CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ AUTOMATION TEST FAILED\n", err);
  process.exit(1);
});
