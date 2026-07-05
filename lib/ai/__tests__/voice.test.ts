/**
 * Voice AI Restaurant Manager tests (fake Firestore; deterministic — no LLM, no audio).
 * Voice is a CLIENT over the existing stack — these tests cover the server orchestration:
 *  - toSpeech shaping (markdown stripped, ₦→naira, %→percent),
 *  - questions routed to the grounded Assistant and spoken,
 *  - "how are we doing?" → the Daily Brief read aloud,
 *  - action commands PROPOSE + require a spoken "yes" (approval-first; nothing runs outright),
 *  - confirmation executes only through the Automation engine, still gated by an enabled rule,
 *  - tenant isolation and write-safety (voice adds NO core writes).
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import { handleVoiceTurn, buildVoiceGreeting, toSpeech } from "../voice";
import { generateRecommendations } from "../recommendations";
import { setAutomationRule } from "../automation";
import type { ActorRef } from "../types";

const CORE = ["restaurants", "orders", "payments", "menu_items", "prepared_items", "users"];
const AI_PREFIX = "ai_";
const now = () => new Date("2026-07-08T12:00:00Z");
const DAY = 86_400_000;
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
// Force deterministic narration (no network) everywhere.
const base = (db: FakeFirestore) => ({ db: asDb(db), now, provider: null as null, actor: owner });

function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  const future = { seconds: Math.floor((now().getTime() + 20 * DAY) / 1000) };
  db.seed("restaurants", "grills", { name: "Grills Capitol", status: "active", subscriptionStatus: "active", subscriptionEndDate: future, deliveryEnabled: true, loyalty: { enabled: false } });
  let n = 0;
  for (let offset = 1; offset <= 14; offset++) {
    const perDay = offset <= 7 ? 3 : 2;
    for (let k = 0; k < perDay; k++) {
      const day = new Date(now().getTime() - offset * DAY);
      day.setUTCHours(18, k, 0, 0);
      db.seed("orders", `o${n++}`, {
        restaurantId: "grills", customerName: `C${n}`, phone: `+23480000${String(n).padStart(4, "0")}`,
        items: [{ name: "Jollof Rice", quantity: 2, price: 2500 }], itemsTotal: 5000, deliveryFee: 0, total: 5000,
        paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "counter", serviceMode: "counter", staffName: "Bola", createdAt: day,
      });
    }
  }
  db.seed("menu_items", "m1", { restaurantId: "grills", name: "Jollof Rice", price: 2500, category: "Rice", available: true });
  db.seed("menu_items", "m3", { restaurantId: "grills", name: "Fish Pepper Soup", price: 4000, category: "Soup", available: false });
  db.seed("users", "u1", { restaurantSlug: "grills", displayName: "Bola", role: "owner" });
  // Foreign tenant.
  db.seed("restaurants", "other", { name: "Other Spot", subscriptionEndDate: future });
  db.seed("orders", "x1", { restaurantId: "other", customerName: "Foreign", phone: "+2349999999999", items: [{ name: "Pizza", quantity: 1, price: 99999 }], itemsTotal: 99999, deliveryFee: 0, total: 99999, paymentMethod: "cash", paymentStatus: "paid", status: "completed", orderSource: "online", serviceMode: "delivery", createdAt: new Date(now().getTime() - DAY) });
  db.seed("menu_items", "xm", { restaurantId: "other", name: "Pizza", price: 99999, category: "Italian", available: true });
  return db;
}

async function main() {
  console.log("\n[Voice] Voice AI Restaurant Manager\n");

  // ── toSpeech shaping (pure) ───────────────────────────────────────────────
  await ok("toSpeech strips markdown and speaks money/percent naturally", () => {
    const s = toSpeech("**Today**: ₦286,000 (up 18%).\n- Jollof Rice is top.");
    assert.ok(!/[#*`_]/.test(s), "no markdown symbols");
    assert.ok(s.includes("286,000 naira"), "₦ spoken as naira");
    assert.ok(s.includes("18 percent"), "% spoken as percent");
    assert.ok(!s.includes("\n"), "newlines flattened to sentences");
  });

  // ── Questions → grounded Assistant, spoken ────────────────────────────────
  await ok("a question is answered by the Assistant and returned as speech", async () => {
    const db = seedDb();
    const r = await handleVoiceTurn("grills", "How are sales this week?", base(db));
    assert.equal(r.intent, "question");
    assert.ok(r.speech.length > 0 && !/[#*`]/.test(r.speech));
    assert.equal(r.pending, null);
    assert.equal(r.executed, false);
  });

  // ── Spoken brief ──────────────────────────────────────────────────────────
  await ok('"how are we doing today?" reads the Daily Brief aloud', async () => {
    const db = seedDb();
    const r = await handleVoiceTurn("grills", "How are we doing today?", base(db));
    assert.equal(r.intent, "brief");
    assert.ok(r.speech.length > 0);
    assert.ok(!/[#*`]/.test(r.speech));
  });

  // ── Purchasing command: propose → confirm ─────────────────────────────────
  await ok('"approve the purchasing plan" PROPOSES and awaits a spoken yes', async () => {
    const db = seedDb();
    const r = await handleVoiceTurn("grills", "Approve the purchasing plan", base(db));
    assert.equal(r.intent, "command");
    assert.ok(r.pending && r.pending.type === "execute_purchasing");
    assert.ok((r.pending!.items ?? []).some((i) => /fish pepper soup/i.test(i)), "HIGH restock proposed");
    assert.equal(r.executed, false, "nothing executes on the proposal");
  });

  await ok('"yes" without an enabled rule approves but does not execute (approval-first)', async () => {
    const db = seedDb();
    const proposal = await handleVoiceTurn("grills", "Approve the purchasing plan", base(db));
    const r = await handleVoiceTurn("grills", "yes", { ...base(db), pending: proposal.pending });
    assert.equal(r.intent, "confirm");
    assert.equal(r.executed, false);
    assert.ok(/enable/i.test(r.speech), "explains the rule must be enabled");
  });

  await ok('with the rule enabled, "yes" drafts the restock orders', async () => {
    const db = seedDb();
    await setAutomationRule("grills", "purchase_order_draft", { enabled: true }, owner, { db: asDb(db), now });
    const proposal = await handleVoiceTurn("grills", "Approve the purchasing plan", base(db));
    const r = await handleVoiceTurn("grills", "yes", { ...base(db), pending: proposal.pending });
    assert.equal(r.executed, true);
    assert.ok(/drafted/i.test(r.speech));
  });

  // ── Recommendation command: propose → confirm ─────────────────────────────
  await ok('"increase Jollof Rice by ₦200" finds the recommendation and asks to confirm', async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now }); // recs must exist to act on
    const r = await handleVoiceTurn("grills", "Increase Jollof Rice by ₦200", base(db));
    assert.equal(r.intent, "command");
    assert.ok(r.pending && r.pending.type === "execute_recommendation" && r.pending.recId);
    assert.ok(/jollof/i.test(r.pending!.label));
    assert.equal(r.executed, false);
  });

  await ok('confirming a recommendation approves it; runs it once notifications are enabled', async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now });
    const proposal = await handleVoiceTurn("grills", "Increase Jollof Rice by ₦200", base(db));

    // Not enabled yet → approved but not executed.
    const r1 = await handleVoiceTurn("grills", "yes", { ...base(db), pending: proposal.pending });
    assert.equal(r1.executed, false);
    assert.ok(/approved/i.test(r1.speech));

    // Enable notifications, confirm again → executes.
    await setAutomationRule("grills", "notify", { enabled: true }, owner, { db: asDb(db), now });
    const r2 = await handleVoiceTurn("grills", "yes", { ...base(db), pending: proposal.pending });
    assert.equal(r2.executed, true);
    assert.ok(/done/i.test(r2.speech));
  });

  await ok('"no" cancels a pending action', async () => {
    const db = seedDb();
    const proposal = await handleVoiceTurn("grills", "Approve the purchasing plan", base(db));
    const r = await handleVoiceTurn("grills", "no", { ...base(db), pending: proposal.pending });
    assert.equal(r.intent, "cancelled");
    assert.equal(r.executed, false);
  });

  // ── Voice-first greeting ────────────────────────────────────────────────────
  await ok("greeting personalises and offers to read pending recommendations", async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now }); // creates "new" recs awaiting approval
    const g = await buildVoiceGreeting("grills", { userName: "Alex", db: asDb(db), now });
    assert.ok(/^Good (morning|afternoon|evening), Alex\./.test(g.display), "personalised greeting");
    assert.ok(g.pendingRecommendations > 0);
    assert.ok(g.pending && g.pending.type === "read_recommendations", "offers to read them");
    assert.ok(!/[#*`]/.test(g.speech));
  });

  await ok('confirming the greeting reads the numbered recommendations aloud', async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now });
    const g = await buildVoiceGreeting("grills", { userName: "Alex", db: asDb(db), now });
    const r = await handleVoiceTurn("grills", "yes", { ...base(db), pending: g.pending });
    assert.ok(/One:/.test(r.display), "recommendations are numbered");
    assert.ok(/approve recommendation one/i.test(r.display), "explains how to act");
  });

  await ok('"approve recommendation one" proposes it with its expected impact', async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now });
    const r = await handleVoiceTurn("grills", "Approve recommendation one", base(db));
    assert.equal(r.intent, "command");
    assert.ok(r.pending && r.pending.type === "execute_recommendation");
    assert.ok(/Recommendation one proposes/i.test(r.speech));
    assert.ok(/Expected impact/i.test(r.speech), "states the expected impact before approval");
    assert.equal(r.executed, false);
  });

  // ── Explainability follow-ups on a pending recommendation ─────────────────
  await ok('"why?" on a proposed recommendation answers from its fields and keeps the offer', async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now });
    const proposal = await handleVoiceTurn("grills", "Approve recommendation one", base(db));
    const r = await handleVoiceTurn("grills", "why?", { ...base(db), pending: proposal.pending });
    assert.equal(r.intent, "confirm");
    assert.ok(r.display.length > 0, "gives a reason");
    assert.ok(r.pending && r.pending.type === "execute_recommendation", "confirmation is preserved");
    assert.equal(r.executed, false);
  });

  await ok('"what if I ignore it?" answers the consequence, still awaiting yes', async () => {
    const db = seedDb();
    await generateRecommendations("grills", { db: asDb(db), now });
    const proposal = await handleVoiceTurn("grills", "Approve recommendation one", base(db));
    const r = await handleVoiceTurn("grills", "what if I ignore it?", { ...base(db), pending: proposal.pending });
    assert.ok(/ignored|forgo|turning away|missed/i.test(r.display), "explains the downside");
    assert.ok(r.pending, "confirmation preserved");
  });

  // ── Tenant isolation ───────────────────────────────────────────────────────
  await ok("voice is tenant-scoped (other never hears grills' data)", async () => {
    const db = seedDb();
    const r = await handleVoiceTurn("other", "How are we doing today?", { ...base(db), actor: { type: "owner", id: "u2" } });
    const blob = `${r.speech} ${r.display}`.toLowerCase();
    assert.ok(!blob.includes("jollof") && !blob.includes("99999"));
  });

  // ── Write-safety across a full voice session ─────────────────────────────────
  await ok("a full voice session writes ONLY ai_* collections (never core)", async () => {
    const db = seedDb();
    await setAutomationRule("grills", "purchase_order_draft", { enabled: true }, owner, { db: asDb(db), now });
    await handleVoiceTurn("grills", "How are we doing today?", base(db));
    await handleVoiceTurn("grills", "How are sales this week?", base(db));
    const proposal = await handleVoiceTurn("grills", "Approve the purchasing plan", base(db));
    await handleVoiceTurn("grills", "yes", { ...base(db), pending: proposal.pending });

    for (const c of CORE) assert.equal(db.writes.filter((w) => w.collection === c).length, 0);
    for (const c of db.writtenCollections()) assert.ok(c.startsWith(AI_PREFIX), `unexpected non-ai collection written: ${c}`);
  });

  console.log(`\n✅ ALL ${passed} VOICE CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ VOICE TEST FAILED\n", err);
  process.exit(1);
});
