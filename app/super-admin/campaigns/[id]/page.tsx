import Link from "next/link";
import { notFound } from "next/navigation";
import { getSuperAdminUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getCampaign, getCampaignOrders } from "@/lib/campaigns/store";
import { tallyParticipants } from "@/lib/campaigns/logic";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await getSuperAdminUser();
  const { id } = await params;
  const db = getAdminDb();
  const campaign = await getCampaign(db, id);
  if (!campaign) return notFound();

  const orders = await getCampaignOrders(db, id);
  const participants = tallyParticipants(orders, campaign);
  const qualified = participants.filter((p) => p.qualified);

  return (
    <div>
      <Link href="/super-admin/campaigns" className="text-sm font-bold text-orange-600 hover:underline">← Campaigns</Link>
      <div className="mt-2 mb-6">
        <h1 className="text-2xl font-black text-gray-900">{campaign.name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          Order {campaign.rule.threshold}× → {campaign.prize || "prize"} · status <b>{campaign.status}</b>
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Participants" value={participants.length} />
        <Stat label={`Qualified (≥${campaign.rule.threshold})`} value={qualified.length} />
        <Stat label="Tagged orders" value={orders.length} />
      </div>

      {participants.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-400">
          No participants yet. Counts appear once orders are tagged to this campaign (a later slice) and marked paid.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left font-bold px-4 py-3">Customer</th>
                <th className="text-left font-bold px-4 py-3">Phone</th>
                <th className="text-left font-bold px-4 py-3">Qualifying orders</th>
                <th className="text-left font-bold px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.phoneKey} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-800">{p.name || "—"}</td>
                  <td className="px-4 py-3 font-mono text-gray-800">{p.fullPhone || "—"}</td>
                  <td className="px-4 py-3 text-gray-800">{p.count} / {campaign.rule.threshold}</td>
                  <td className="px-4 py-3">
                    {p.qualified
                      ? <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Qualified</span>
                      : <span className="text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">In progress</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        Full phone numbers are shown here for winner contact (super-admin only — never exposed on public/customer surfaces).
        Winner selection is manual — review qualified participants and contact them directly. No prizes are awarded automatically.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <p className="text-2xl font-black text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
