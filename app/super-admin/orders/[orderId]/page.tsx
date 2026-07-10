import Link from "next/link";
import { notFound } from "next/navigation";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getCampaign } from "@/lib/campaigns/store";
import { toOrderDetail } from "@/lib/orders/admin-view";
import { formatAmount, formatWhen } from "../orders-ui-lib";

export const dynamic = "force-dynamic";

function Badge({ value, tone }: { value: string; tone: "good" | "bad" | "neutral" }) {
  const cls = tone === "good" ? "bg-emerald-100 text-emerald-700" : tone === "bad" ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-600";
  return <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${cls}`}>{value || "—"}</span>;
}
const payTone = (v: string) => (v === "paid" ? "good" : v === "unpaid" ? "bad" : "neutral");
const statusTone = (v: string) => (["completed", "ready", "accepted", "preparing"].includes(v) ? "good" : ["rejected", "voided"].includes(v) ? "bad" : "neutral");

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <h2 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-3">{title}</h2>
      {children}
    </div>
  );
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-gray-50 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium text-right">{value ?? "—"}</span>
    </div>
  );
}

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  await getSuperAdminUser();
  const { orderId } = await params;
  const db = getAdminDb();

  const doc = await db.collection("orders").doc(orderId).get();
  if (!doc.exists) return notFound();

  const data = doc.data() as Record<string, unknown>;
  const restaurantId = String(data.restaurantId ?? "");
  const restaurantName = restaurantId
    ? ((await db.collection("restaurants").doc(restaurantId).get()).data()?.name as string | undefined) ?? null
    : null;
  const campaignId = typeof data.campaignId === "string" && data.campaignId.trim() ? data.campaignId.trim() : null;
  const campaign = campaignId ? await getCampaign(db, campaignId).catch(() => null) : null;

  const o = toOrderDetail(doc.id, data, restaurantName, campaign);

  return (
    <div>
      <Link href="/super-admin/orders" className="text-sm font-bold text-orange-600 hover:underline">← Live Orders</Link>

      <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-black text-gray-900">Order #{o.orderNumber ?? "—"}</h1>
        <Badge value={o.status} tone={statusTone(o.status)} />
        <Badge value={o.paymentStatus} tone={payTone(o.paymentStatus)} />
        <code className="font-mono text-xs text-gray-400">{o.orderId}</code>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Customer">
          <Row label="Name" value={o.customerName || "—"} />
          <Row label="Phone (full)" value={<span className="font-mono">{o.phone || "—"}</span>} />
          <Row label="Address" value={o.address || "—"} />
          {o.note ? <Row label="Note" value={o.note} /> : null}
        </Card>

        <Card title="Restaurant">
          <Row label="Name" value={o.restaurantName ?? o.restaurantId} />
          <Row label="Slug" value={<Link href={`/r/${o.restaurantSlug}`} className="text-orange-600 hover:underline">{o.restaurantSlug}</Link>} />
        </Card>

        <Card title="Fulfilment">
          <Row label="Type" value={o.deliveryType || "—"} />
          {o.serviceMode ? <Row label="Service mode" value={o.serviceMode} /> : null}
          {o.tableLabel ? <Row label="Table" value={o.tableLabel} /> : null}
          {o.deliveryZoneName ? <Row label="Delivery zone" value={o.deliveryZoneName} /> : null}
          <Row label="Order type" value={o.orderType || "normal"} />
          {o.scheduledFor ? <Row label="Scheduled for" value={o.scheduledFor} /> : null}
        </Card>

        <Card title="Payment">
          <Row label="Method" value={o.paymentMethod || "—"} />
          <Row label="Status" value={<Badge value={o.paymentStatus} tone={payTone(o.paymentStatus)} />} />
          {o.paymentReference ? <Row label="Reference" value={<span className="font-mono text-xs">{o.paymentReference}</span>} /> : null}
        </Card>
      </div>

      {/* Items */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left font-bold px-4 py-3">Item</th>
                <th className="text-right font-bold px-4 py-3">Qty</th>
                <th className="text-right font-bold px-4 py-3">Unit</th>
                <th className="text-right font-bold px-4 py-3">Line total</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-gray-800 font-medium">{it.name}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{it.quantity}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{formatAmount(it.unitPrice)}</td>
                  <td className="px-4 py-3 text-right text-gray-900 font-semibold">{formatAmount(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50/60 text-sm">
              <tr><td colSpan={3} className="px-4 py-2 text-right text-gray-500">Items total</td><td className="px-4 py-2 text-right font-semibold">{formatAmount(o.itemsTotal)}</td></tr>
              <tr><td colSpan={3} className="px-4 py-2 text-right text-gray-500">Delivery fee</td><td className="px-4 py-2 text-right font-semibold">{formatAmount(o.deliveryFee)}</td></tr>
              <tr><td colSpan={3} className="px-4 py-3 text-right font-black text-gray-900">Total</td><td className="px-4 py-3 text-right font-black text-gray-900">{formatAmount(o.total)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mt-4">
        {o.campaign ? (
          <Card title="Campaign attribution">
            <Row label="Campaign" value={o.campaign.name} />
            <Row label="Threshold" value={`Order ${o.campaign.threshold}×`} />
            <Row label="Campaign ID" value={<span className="font-mono text-xs">{o.campaign.id}</span>} />
          </Card>
        ) : (
          <Card title="Campaign attribution"><p className="text-sm text-gray-400">Not attributed to a campaign.</p></Card>
        )}

        <Card title="Timeline">
          <Row label="Created" value={formatWhen(o.createdAtMs)} />
          <Row label="Last updated" value={formatWhen(o.updatedAtMs)} />
          {o.timeline.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {o.timeline.map((e) => (
                <li key={e.key} className="flex items-center gap-2 text-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0" />
                  <span className="text-gray-700 font-medium">{e.label}</span>
                  <span className="text-gray-400 ml-auto">{formatWhen(e.atMs)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[11px] text-gray-400 mt-3">Derived from available status timestamps (no dedicated event log yet).</p>
        </Card>
      </div>
    </div>
  );
}
