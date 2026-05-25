import { getAdminDb } from "@/lib/firebase-admin";
import { getPlanSafe } from "@/lib/plans";

export const revalidate = 0;

function fmtMoney(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}

function fmtDate(ts: { toDate?: () => Date; seconds?: number } | null | undefined) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date((ts.seconds ?? 0) * 1000);
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export default async function SuperAdminOverview() {
  const db = getAdminDb();

  const [restaurantsSnap, ordersSnap, paymentsSnap] = await Promise.all([
    db.collection("restaurants").get(),
    db.collection("orders").count().get(),
    db.collection("payments").get(),
  ]);

  const now = new Date();
  const restaurants = restaurantsSnap.docs.map((d) => d.data());

  let active = 0, expired = 0, suspended = 0, trialing = 0;
  let mrr = 0;

  for (const r of restaurants) {
    const endDate = r.subscriptionEndDate
      ? (r.subscriptionEndDate.toDate ? r.subscriptionEndDate.toDate() : new Date((r.subscriptionEndDate.seconds ?? 0) * 1000))
      : null;

    const status = r.subscriptionStatus as string | undefined;
    if (status === "suspended") {
      suspended++;
    } else if (endDate && endDate < now) {
      expired++;
    } else if (status === "trialing") {
      trialing++;
    } else {
      active++;
      const plan = getPlanSafe(r.planId as string);
      if (plan) mrr += plan.monthlyPrice;
    }
  }

  const totalOrders = ordersSnap.data().count;

  let totalRevenue = 0;
  const recentPayments: { restaurant: string; amount: number; date: string; status: string; ref: string }[] = [];

  for (const doc of paymentsSnap.docs) {
    const p = doc.data();
    const amount = (p.amount as number) ?? 0;
    const status = (p.status as string) ?? "";
    if (status === "completed" || status === "success") totalRevenue += amount;
    recentPayments.push({
      restaurant: (p.restaurantId as string) ?? "—",
      amount,
      status,
      ref: (p.paystackReference as string) ?? doc.id.slice(0, 8),
      date: fmtDate(p.createdAt as Parameters<typeof fmtDate>[0]),
    });
  }

  recentPayments.sort((a, b) => b.amount - a.amount).splice(10);

  const recentSignups = restaurantsSnap.docs
    .map((d) => ({ name: d.data().name as string, slug: d.id, date: fmtDate(d.data().createdAt as Parameters<typeof fmtDate>[0]), plan: d.data().planId as string }))
    .sort((a) => (a.date ? -1 : 1))
    .slice(0, 10);

  const stats = [
    { label: "Total Restaurants", value: restaurants.length, color: "text-gray-900" },
    { label: "Active", value: active, color: "text-green-600" },
    { label: "Trialing", value: trialing, color: "text-amber-600" },
    { label: "Expired", value: expired, color: "text-red-600" },
    { label: "Suspended", value: suspended, color: "text-gray-500" },
    { label: "Total Orders", value: totalOrders.toLocaleString(), color: "text-gray-900" },
    { label: "MRR", value: fmtMoney(mrr), color: "text-orange-600" },
    { label: "Total Revenue", value: fmtMoney(totalRevenue), color: "text-green-600" },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-black text-gray-900">Platform Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">{s.label}</p>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="text-sm font-black text-gray-700 uppercase tracking-widest mb-4">Recent Signups</h2>
          <div className="space-y-3">
            {recentSignups.map((r) => (
              <div key={r.slug} className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-400">{r.slug} · {r.plan}</p>
                </div>
                <span className="text-xs text-gray-400">{r.date}</span>
              </div>
            ))}
            {recentSignups.length === 0 && <p className="text-sm text-gray-400">No restaurants yet.</p>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="text-sm font-black text-gray-700 uppercase tracking-widest mb-4">Recent Payments</h2>
          <div className="space-y-3">
            {recentPayments.map((p, i) => (
              <div key={i} className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm text-gray-900">{p.restaurant}</p>
                  <p className="text-xs font-mono text-gray-400">{p.ref}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-sm text-gray-900">{fmtMoney(p.amount)}</p>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${p.status === "completed" || p.status === "success" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                    {p.status}
                  </span>
                </div>
              </div>
            ))}
            {recentPayments.length === 0 && <p className="text-sm text-gray-400">No payments yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
