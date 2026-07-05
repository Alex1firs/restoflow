/**
 * Command Layer tests (Intent + Target model).
 *
 * Proves:
 *   - many phrasings collapse to the same (intent, target) — "show orders",
 *     "take me to orders", "open today's orders" are one command
 *   - actions carry an ordinal id ("approve recommendation two" → id 2)
 *   - analysis questions are NOT commands (parseCommand → null) so they fall
 *     through to the grounded Assistant
 *   - webNavigation maps targets to tenant routes (pages + dashboard anchors)
 *   - end-to-end: a navigation command returns a `navigation` field on the voice turn
 *
 * Run: npm run test:ai
 */
import assert from "node:assert";
import { FakeFirestore } from "./fake-firestore";
import { parseCommand, webNavigation, parseCommandOrdinal, type CommandTarget } from "../commands";
import { handleVoiceTurn } from "../voice";

const now = () => new Date("2026-07-04T12:00:00Z");
let passed = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function seedDb(): FakeFirestore {
  const db = new FakeFirestore();
  const future = { seconds: Math.floor((now().getTime() + 20 * 86_400_000) / 1000) };
  db.seed("restaurants", "grills", { name: "Grills Capitol", status: "active", subscriptionStatus: "active", subscriptionEndDate: future });
  db.seed("orders", "o1", {
    restaurantId: "grills", customerName: "Ada", phone: "+2348011112222",
    items: [{ name: "Jollof Rice", quantity: 2, price: 2500 }],
    itemsTotal: 5000, deliveryFee: 0, total: 5000,
    paymentMethod: "cash", paymentStatus: "paid", status: "completed",
    orderSource: "counter", serviceMode: "counter", createdAt: new Date("2026-07-04T09:00:00Z"),
  });
  db.seed("menu_items", "m1", { restaurantId: "grills", name: "Jollof Rice", price: 2500, category: "Rice", available: true });
  db.seed("users", "u1", { restaurantSlug: "grills", displayName: "Bola", role: "owner" });
  return db;
}

async function main() {
  console.log("\n[Commands] Intent + Target command layer\n");

  // --- Many phrasings → one (intent, target) ---
  await ok("different phrasings collapse to the same OPEN/orders command", () => {
    for (const phrase of ["open today's orders", "show orders", "take me to orders", "go to the orders page", "pull up orders"]) {
      const c = parseCommand(phrase);
      assert.ok(c, `"${phrase}" should parse`);
      assert.equal(c!.intent, "open", `"${phrase}" intent`);
      assert.equal(c!.target, "orders", `"${phrase}" target`);
    }
  });

  await ok("target synonyms resolve to the canonical target", () => {
    const cases: [string, CommandTarget][] = [
      ["open the kitchen", "kitchen"],
      ["show smart purchasing", "purchasing"],
      ["open operating profile", "profile"],
      ["show recommendations", "recommendations"],
      ["open reports", "reports"],
      ["show inventory", "inventory"],
      ["take me to staff", "staff"],
      ["open the forecast", "forecast"],
      ["show automation", "automation"],
      ["open the menu", "menu"],
    ];
    for (const [phrase, target] of cases) {
      const c = parseCommand(phrase);
      assert.ok(c && c.target === target, `"${phrase}" → ${target}, got ${c?.intent}/${c?.target}`);
    }
  });

  // --- Actions carry an ordinal ---
  await ok("approve/reject/explain a recommendation carry the ordinal id", () => {
    const approve = parseCommand("approve recommendation two");
    assert.deepEqual([approve?.intent, approve?.target, approve?.id], ["approve", "recommendations", 2]);

    const reject = parseCommand("reject recommendation three");
    assert.deepEqual([reject?.intent, reject?.target, reject?.id], ["reject", "recommendations", 3]);

    const explain = parseCommand("explain recommendation one");
    assert.deepEqual([explain?.intent, explain?.target, explain?.id], ["explain", "recommendations", 1]);

    assert.equal(parseCommandOrdinal("recommendation number 4"), 4);
    assert.equal(parseCommandOrdinal("the first one"), 1);
  });

  await ok("read commands only claim genuinely readable targets", () => {
    assert.equal(parseCommand("read today's brief")?.intent, "read");
    assert.equal(parseCommand("read the recommendations")?.target, "recommendations");
    assert.equal(parseCommand("read the purchasing plan")?.target, "purchasing");
  });

  // --- Analysis questions are NOT commands ---
  await ok("analysis questions are NOT commands (fall through to the Assistant)", () => {
    for (const q of [
      "why did revenue drop?",
      "compare this week with last week",
      "show my worst-selling items",
      "what's my biggest opportunity today?",
      "how much did we make this week?",
      "is there any tax for me to do?",
    ]) {
      assert.equal(parseCommand(q), null, `"${q}" must not be treated as a command`);
    }
  });

  // --- Web navigation mapping ---
  await ok("webNavigation maps targets to tenant routes (pages + dashboard anchors)", () => {
    assert.equal(webNavigation("orders", "grills").path, "/admin/grills/orders");
    assert.equal(webNavigation("profile", "grills").path, "/admin/grills/operating-profile");
    const recs = webNavigation("recommendations", "grills");
    assert.equal(recs.path, "/admin/grills/dashboard");
    assert.equal(recs.anchor, "ai-recommendations");
  });

  // --- The routing layer is channel-agnostic (voice, chat, future all share it) ---
  await ok("the same utterance routes identically regardless of channel", () => {
    // Voice (server) and chat (client) both call parseCommand + webNavigation — there
    // is ONE routing layer, so a given utterance must resolve to one destination.
    const utterances = ["open today's orders", "take me to orders", "show orders"];
    const destinations = utterances.map((u) => {
      const c = parseCommand(u)!;
      return webNavigation(c.target, "grills").path;
    });
    assert.deepEqual(destinations, ["/admin/grills/orders", "/admin/grills/orders", "/admin/grills/orders"]);

    // And it's tenant-parameterised, not hard-coded per page.
    assert.equal(webNavigation(parseCommand("open the kitchen")!.target, "tricias").path, "/admin/tricias/kitchen");
  });

  // --- End-to-end: a navigation command drives the voice turn ---
  {
    const db = seedDb();
    const base = { db: db as unknown as FirebaseFirestore.Firestore, now, provider: null };

    await ok("handleVoiceTurn resolves 'open today's orders' to a navigation result", async () => {
      const r = await handleVoiceTurn("grills", "open today's orders", base);
      assert.equal(r.intent, "command");
      assert.ok(r.navigation && r.navigation.path === "/admin/grills/orders", `navigation: ${JSON.stringify(r.navigation)}`);
      assert.ok(/opening/i.test(r.speech), r.speech);
      assert.equal(r.executed, false);
    });

    await ok("a plain question does NOT navigate", async () => {
      const r = await handleVoiceTurn("grills", "how much did we make today?", base);
      assert.ok(!r.navigation, "questions must not carry navigation");
      assert.equal(r.intent, "question");
    });

    await ok("navigation writes nothing (read-only)", () => {
      // Only the assistant question above persists usage; navigation itself writes nothing new beyond ai_usage.
      for (const c of ["restaurants", "orders", "payments", "menu_items", "prepared_items", "users"]) {
        assert.equal(db.writes.filter((w) => w.collection === c).length, 0, `wrote to core collection ${c}`);
      }
    });
  }

  console.log(`\n✅ ALL ${passed} COMMAND CHECKS PASSED\n`);
}

main().catch((err) => {
  console.error("\n❌ COMMAND TEST FAILED\n", err);
  process.exit(1);
});
