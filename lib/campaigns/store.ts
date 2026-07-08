// Admin-SDK data access for campaigns (Slice 2). Type-only firebase import so it
// can be used from server routes. READ-ONLY over `orders`; writes ONLY to the
// `campaigns` collection (the campaign model itself). Never touches order docs.

import type { Firestore } from "firebase-admin/firestore";
import type { Campaign, CampaignEntryPoint, CampaignOrder, CampaignStatus } from "./types";

const COL = "campaigns";

function toMillis(v: unknown): number {
  if (typeof v === "number") return v;
  const o = (v ?? {}) as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof o.toMillis === "function") return o.toMillis();
  if (typeof o.seconds === "number") return o.seconds * 1000;
  if (typeof o._seconds === "number") return o._seconds * 1000;
  return 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeStatus(v: unknown): CampaignStatus {
  return v === "active" || v === "ended" ? v : "draft";
}

function normalizeEntryPoints(v: unknown): CampaignEntryPoint[] {
  const allowed: CampaignEntryPoint[] = ["landing", "discover"];
  if (!Array.isArray(v)) return [];
  return allowed.filter((a) => v.includes(a));
}

function mapCampaign(id: string, d: Record<string, unknown>): Campaign {
  const rule = (d.rule ?? {}) as { type?: unknown; threshold?: unknown };
  return {
    id,
    name: String(d.name ?? ""),
    description: String(d.description ?? ""),
    status: normalizeStatus(d.status),
    startAtMs: numOrNull(d.startAtMs),
    endAtMs: numOrNull(d.endAtMs),
    rule: { type: "order_count", threshold: typeof rule.threshold === "number" ? rule.threshold : 0 },
    prize: String(d.prize ?? ""),
    entryPoints: normalizeEntryPoints(d.entryPoints),
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
    createdBy: String(d.createdBy ?? ""),
  };
}

export async function listCampaigns(db: Firestore): Promise<Campaign[]> {
  const snap = await db.collection(COL).get();
  return snap.docs
    .map((doc) => mapCampaign(doc.id, doc.data() as Record<string, unknown>))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/** READ-ONLY: campaigns that are live right now (status active + within window). */
export async function listActiveCampaigns(db: Firestore, nowMs: number): Promise<Campaign[]> {
  const snap = await db.collection(COL).where("status", "==", "active").get();
  return snap.docs
    .map((doc) => mapCampaign(doc.id, doc.data() as Record<string, unknown>))
    .filter((c) => (c.startAtMs == null || nowMs >= c.startAtMs) && (c.endAtMs == null || nowMs <= c.endAtMs))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export async function getCampaign(db: Firestore, id: string): Promise<Campaign | null> {
  const doc = await db.collection(COL).doc(id).get();
  if (!doc.exists) return null;
  return mapCampaign(doc.id, doc.data() as Record<string, unknown>);
}

export type CampaignInput = {
  id?: string;
  name: string;
  description?: string;
  status?: CampaignStatus;
  startAtMs?: number | null;
  endAtMs?: number | null;
  threshold: number;
  prize?: string;
  entryPoints?: CampaignEntryPoint[];
  createdBy: string;
};

/**
 * Create or edit a campaign document. This is the ONLY write in the campaign
 * feature so far — it touches `campaigns` only, never `orders`.
 */
export async function upsertCampaign(
  db: Firestore,
  input: CampaignInput,
  serverTimestamp: () => unknown,
): Promise<string> {
  const ref = input.id ? db.collection(COL).doc(input.id) : db.collection(COL).doc();
  const exists = input.id ? (await ref.get()).exists : false;
  const base = {
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    status: normalizeStatus(input.status),
    startAtMs: numOrNull(input.startAtMs ?? null),
    endAtMs: numOrNull(input.endAtMs ?? null),
    rule: { type: "order_count", threshold: Math.max(1, Math.floor(input.threshold || 1)) },
    prize: (input.prize ?? "").trim(),
    entryPoints: normalizeEntryPoints(input.entryPoints),
    updatedAt: serverTimestamp(),
  };
  if (exists) {
    await ref.set(base, { merge: true });
  } else {
    await ref.set({ ...base, createdAt: serverTimestamp(), createdBy: input.createdBy });
  }
  return ref.id;
}

/**
 * READ-ONLY orders tagged to a campaign. Until the tagging slice ships, no order
 * carries `campaignId`, so this returns [] — the participant view is simply empty.
 */
export async function getCampaignOrders(db: Firestore, campaignId: string): Promise<CampaignOrder[]> {
  const snap = await db.collection("orders").where("campaignId", "==", campaignId).get();
  return snap.docs.map((doc) => {
    const x = doc.data() as Record<string, unknown>;
    return {
      orderId: doc.id,
      campaignId: (x.campaignId as string | null) ?? null,
      phone: String(x.phone ?? ""),
      customerName: x.customerName as string | undefined,
      paymentStatus: x.paymentStatus as string | undefined,
      status: x.status as string | undefined,
      createdAtMs: toMillis(x.createdAt),
    };
  });
}
