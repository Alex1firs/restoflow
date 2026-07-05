import "server-only";
import { assertTenant } from "./guardrails";
import { createIntelligenceContext } from "./tools/_shared";
import type {
  ActorRef,
  AIPreferences,
  BusinessGoal,
  BusinessPreferences,
  LearnedPreference,
  OwnerPreferences,
  ProfileAuditEntry,
  Recommendation,
  RestaurantOperatingProfile,
} from "./types";

/**
 * Restaurant Operating Profile (Phase 7.2)
 * ========================================
 * A restaurant-scoped operating profile that becomes ANOTHER INPUT into every AI
 * decision — Assistant, Recommendations, Forecasting, Purchasing, Voice — WITHOUT
 * changing any engine's deterministic judgement.
 *
 * How it stays non-invasive:
 *  - The profile is loaded during context building (`context.profile`).
 *  - Engine rule bodies are untouched. The profile is APPLIED as a pure post-pass at
 *    the CONSUMPTION boundary (routes / voice) via `applyProfileToRecommendations`,
 *    `profileNarrationDirective`, `applyProfileToPurchasing`. Under the default profile
 *    these are identity functions, so existing behaviour is unchanged.
 *
 * Safety: restaurant-scoped, owner-editable, versioned, fully audited. Writes ONLY to
 * `ai_operating_profiles` + `ai_operating_profile_audit`. Never touches business data.
 * Deterministic and testable.
 */

export const AI_OPERATING_PROFILE_COLLECTION = "ai_operating_profiles";
export const AI_OPERATING_PROFILE_AUDIT_COLLECTION = "ai_operating_profile_audit";
const PROFILE_LEARN_THRESHOLD = 2; // decisions before a learned pattern activates

// ---------------------------------------------------------------------------
// Defaults — a fresh profile is a no-op input (identity application)
// ---------------------------------------------------------------------------

export function defaultBusinessPreferences(): BusinessPreferences {
  return {
    primaryGoal: null,
    pricingPhilosophy: null,
    maxPriceIncreaseNaira: null,
    preferPromotionsOverPriceIncrease: false,
    preferredSuppliers: [],
    openingHours: null,
    staffingPhilosophy: null,
    preparationStyle: null,
  };
}
export function defaultOwnerPreferences(): OwnerPreferences {
  return { language: "en", primaryInterface: "voice", responseStyle: "detailed", notificationHours: null, notificationChannel: "in_app" };
}
export function defaultAIPreferences(): AIPreferences {
  return { confidenceThreshold: 0, automationLevel: "assisted", escalationRules: null, reminderFrequency: "daily" };
}

function defaultProfile(slug: string, iso: string): RestaurantOperatingProfile {
  return {
    restaurantId: slug,
    business: defaultBusinessPreferences(),
    owner: defaultOwnerPreferences(),
    ai: defaultAIPreferences(),
    learned: [],
    version: 0,
    updatedAt: iso,
    updatedBy: null,
  };
}

// ---------------------------------------------------------------------------
// Data layer (read / update / reset) — restaurant-scoped, versioned, audited
// ---------------------------------------------------------------------------

interface BaseOpts {
  db?: FirebaseFirestore.Firestore;
  now?: () => Date;
}

/** Load the operating profile (defaults merged in). Read-only. */
export async function getOperatingProfile(slug: string, opts: BaseOpts = {}): Promise<RestaurantOperatingProfile> {
  const ctx = createIntelligenceContext(slug, { feature: "profile-read", now: opts.now, db: opts.db });
  const snap = await ctx.db.collection(AI_OPERATING_PROFILE_COLLECTION).doc(slug).get();
  const base = defaultProfile(slug, ctx.now().toISOString());
  if (!snap.exists) return base;
  const stored = snap.data() as Partial<RestaurantOperatingProfile>;
  assertTenant(ctx.scope, stored as Record<string, unknown>);
  // Merge section-by-section so newly-added fields inherit defaults.
  return {
    restaurantId: slug,
    business: { ...base.business, ...(stored.business ?? {}) },
    owner: { ...base.owner, ...(stored.owner ?? {}) },
    ai: { ...base.ai, ...(stored.ai ?? {}) },
    learned: Array.isArray(stored.learned) ? stored.learned : [],
    version: stored.version ?? 0,
    updatedAt: stored.updatedAt ?? base.updatedAt,
    updatedBy: stored.updatedBy ?? null,
  };
}

export interface ProfileUpdatePatch {
  business?: Partial<BusinessPreferences>;
  owner?: Partial<OwnerPreferences>;
  ai?: Partial<AIPreferences>;
  learned?: LearnedPreference[];
}

/** Apply an owner edit — merges per section, bumps the version, writes an audit entry. */
export async function updateOperatingProfile(
  slug: string,
  patch: ProfileUpdatePatch,
  actor: ActorRef,
  opts: BaseOpts = {}
): Promise<RestaurantOperatingProfile> {
  const ctx = createIntelligenceContext(slug, { feature: "profile-update", now: opts.now, db: opts.db });
  const current = await getOperatingProfile(slug, { db: ctx.db, now: opts.now });
  const iso = ctx.now().toISOString();

  const changedKeys: string[] = [];
  const next: RestaurantOperatingProfile = { ...current, version: current.version + 1, updatedAt: iso, updatedBy: actor };
  let section: ProfileAuditEntry["section"] = "business";

  if (patch.business) {
    next.business = { ...current.business, ...patch.business };
    changedKeys.push(...Object.keys(patch.business).map((k) => `business.${k}`));
    section = "business";
  }
  if (patch.owner) {
    next.owner = { ...current.owner, ...patch.owner };
    changedKeys.push(...Object.keys(patch.owner).map((k) => `owner.${k}`));
    section = "owner";
  }
  if (patch.ai) {
    next.ai = { ...current.ai, ...patch.ai };
    changedKeys.push(...Object.keys(patch.ai).map((k) => `ai.${k}`));
    section = "ai";
  }
  if (patch.learned) {
    next.learned = patch.learned;
    changedKeys.push("learned");
    section = "learned";
  }

  await ctx.db.collection(AI_OPERATING_PROFILE_COLLECTION).doc(slug).set(next);
  await writeAudit(ctx, next.version, section, changedKeys, actor, iso);
  return next;
}

/** Clear all learned preferences (owner-triggered). Audited. */
export async function resetLearnedPreferences(slug: string, actor: ActorRef, opts: BaseOpts = {}): Promise<RestaurantOperatingProfile> {
  const ctx = createIntelligenceContext(slug, { feature: "profile-reset", now: opts.now, db: opts.db });
  const current = await getOperatingProfile(slug, { db: ctx.db, now: opts.now });
  const iso = ctx.now().toISOString();
  const next: RestaurantOperatingProfile = { ...current, learned: [], version: current.version + 1, updatedAt: iso, updatedBy: actor };
  await ctx.db.collection(AI_OPERATING_PROFILE_COLLECTION).doc(slug).set(next);
  await writeAudit(ctx, next.version, "reset_learned", ["learned"], actor, iso);
  return next;
}

/**
 * Gradual learning: fold an owner decision (accept/dismiss a recommendation type) into
 * the learned preferences. Transparent (human statement), editable, resettable, audited.
 * Additive — called from the recommendation-status route, not from any engine.
 */
export async function learnFromDecision(
  slug: string,
  recType: string,
  decision: "accepted" | "dismissed",
  actor: ActorRef,
  opts: BaseOpts = {}
): Promise<void> {
  const ctx = createIntelligenceContext(slug, { feature: "profile-learn", now: opts.now, db: opts.db });
  const current = await getOperatingProfile(slug, { db: ctx.db, now: opts.now });
  const iso = ctx.now().toISOString();

  const kind = decision === "accepted" ? "accepts" : "rejects";
  const id = `auto:${kind}:${recType}`;
  const learned = [...current.learned];
  const idx = learned.findIndex((l) => l.id === id);
  const prevCount = idx >= 0 ? Number(learned[idx].params.count ?? 0) : 0;
  const count = prevCount + 1;
  const active = count >= PROFILE_LEARN_THRESHOLD;
  const verb = kind === "accepts" ? "usually accept" : "tend to reject";
  const pref: LearnedPreference = {
    id,
    statement: `You ${verb} ${humanType(recType)} recommendations.`,
    type: kind,
    subject: recType,
    params: { count },
    source: "learned",
    active,
    confidence: Math.min(0.9, count * 0.3),
    createdAt: idx >= 0 ? learned[idx].createdAt : iso,
    updatedAt: iso,
  };
  if (idx >= 0) learned[idx] = pref;
  else learned.push(pref);

  const next: RestaurantOperatingProfile = { ...current, learned, version: current.version + 1, updatedAt: iso, updatedBy: actor };
  await ctx.db.collection(AI_OPERATING_PROFILE_COLLECTION).doc(slug).set(next);
  await writeAudit(ctx, next.version, "learned", [`learned.${id}`], actor, iso);
}

async function writeAudit(
  ctx: ReturnType<typeof createIntelligenceContext>,
  version: number,
  section: ProfileAuditEntry["section"],
  changedKeys: string[],
  actor: ActorRef,
  iso: string
): Promise<void> {
  const slug = ctx.scope.restaurantSlug;
  const entry: ProfileAuditEntry = { id: `${slug}:v${version}`, restaurantId: slug, version, section, changedKeys, actor, at: iso };
  await ctx.db.collection(AI_OPERATING_PROFILE_AUDIT_COLLECTION).doc(entry.id).set(entry);
}

/** The versioned audit history for a restaurant's profile. */
export async function listProfileAudit(slug: string, opts: BaseOpts = {}): Promise<ProfileAuditEntry[]> {
  const ctx = createIntelligenceContext(slug, { feature: "profile-audit", now: opts.now, db: opts.db });
  const snap = await ctx.db.collection(AI_OPERATING_PROFILE_AUDIT_COLLECTION).where("restaurantId", "==", slug).get();
  return snap.docs
    .map((d) => d.data() as ProfileAuditEntry)
    .filter((e) => {
      assertTenant(ctx.scope, e as unknown as Record<string, unknown>);
      return true;
    })
    .sort((a, b) => b.version - a.version);
}

// ---------------------------------------------------------------------------
// Application layer (pure) — applied at the consumption boundary, not in engines
// ---------------------------------------------------------------------------

/**
 * Which recommendation types a declared business goal prioritises. The underlying
 * data is unchanged — the goal only re-orders which advice surfaces first.
 */
export const GOAL_BOOSTS: Record<BusinessGoal, string[]> = {
  maximize_profit: ["price_increase", "bundle"],
  grow_revenue: ["price_increase", "bundle", "staffing"],
  increase_retention: ["loyalty", "promote_item"],
  increase_repeat_orders: ["loyalty", "promote_item"],
  reduce_food_waste: ["promote_item", "bundle"],
  improve_kitchen_speed: ["staffing"],
  reduce_stockouts: ["reenable_item"],
  launch_new_items: ["promote_item", "bundle"],
};

/**
 * Apply the profile to a deterministic recommendation set. Pure & deterministic:
 *  - hides recommendations below the owner's confidence threshold,
 *  - drops price-increase recs whose delta exceeds the owner's cap,
 *  - demotes price increases (and lifts promotions) when the owner prefers promotions,
 *  - re-orders to surface the recommendations that serve the declared business goal.
 * Under the default profile this returns the input order unchanged.
 */
export function applyProfileToRecommendations(recs: Recommendation[], profile: RestaurantOperatingProfile): Recommendation[] {
  const cap = profile.business.maxPriceIncreaseNaira;
  const preferPromos = profile.business.preferPromotionsOverPriceIncrease || profile.learned.some((l) => l.active && l.type === "prefers" && l.subject === "promotion_over_price");
  const threshold = profile.ai.confidenceThreshold;
  const goal = profile.business.primaryGoal;

  let kept = recs.filter((r) => {
    if (r.confidence < threshold) return false;
    if (r.type === "price_increase" && cap != null && (r.action?.delta ?? 0) > cap) return false;
    return true;
  });

  if (preferPromos) {
    // Stable demotion: price increases sink below everything else, promotions rise.
    const weight = (r: Recommendation) => (r.type === "promote_item" ? -1 : r.type === "price_increase" ? 1 : 0);
    kept = [...kept].sort((a, b) => weight(a) - weight(b));
  }

  if (goal) {
    // Stable boost: recommendation types serving the goal float to the top.
    const boosted = new Set(GOAL_BOOSTS[goal]);
    const rank = (r: Recommendation) => (boosted.has(r.type) ? 0 : 1);
    kept = kept.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
  }

  return kept;
}

/** A narration-style directive appended to the Assistant/Voice system prompt. "" for defaults. */
export function profileNarrationDirective(profile: RestaurantOperatingProfile): string {
  const bits: string[] = [];
  if (profile.owner.responseStyle === "concise") bits.push("Keep answers brief and to the point.");
  if (profile.owner.language && profile.owner.language !== "en") bits.push(`Respond in the owner's preferred language (${profile.owner.language}).`);
  return bits.join(" ");
}

/** Attach the owner's preferred supplier to a purchasing plan response (non-mutating). */
export function preferredSupplierFor(profile: RestaurantOperatingProfile): string | null {
  return profile.business.preferredSuppliers[0] ?? null;
}

function humanType(recType: string): string {
  return recType.replace(/_/g, " ");
}
