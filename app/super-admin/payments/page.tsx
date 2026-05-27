import { getAdminDb } from "@/lib/firebase-admin";

export const revalidate = 0;

function fmtDate(ts: { toDate?: () => Date; seconds?: number } | null | undefined) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date((ts.seconds ?? 0) * 1000);
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export default async function SuperAdminPaymentsPage() {
  const snap = await getAdminDb().collection("payments").orderBy("createdAt", "desc").limit(200).get();

  const payments = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      restaurant: (d.restaurantId as string) ?? "—",
      ref: (d.paystackReference as string) ?? doc.id.slice(0, 10),
      amount: (d.amount as number) ?? 0,
      status: (d.status as string) ?? "pending",
      type: (d.type as string) ?? "—",
      date: fmtDate(d.createdAt as Parameters<typeof fmtDate>[0]),
    };
  });

  const totalRevenue = payments.filter((p) => p.status === "completed" || p.status === "success").reduce((s, p) => s + p.amount, 0);
  const failed = payments.filter((p) => p.status === "failed").length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black text-gray-900">Platform Payments</h1>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Total Payments</p>
          <p className="text-2xl font-black text-gray-900">{payments.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Total Revenue</p>
          <p className="text-2xl font-black text-green-600">₦{totalRevenue.toLocaleString("en-NG")}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Failed Payments</p>
          <p className="text-2xl font-black text-red-600">{failed}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {["Restaurant", "Reference", "Amount", "Type", "Status", "Date"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-bold text-gray-900">{p.restaurant}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.ref}</td>
                  <td className="px-4 py-3 font-bold text-gray-900">₦{p.amount.toLocaleString("en-NG")}</td>
                  <td className="px-4 py-3 text-gray-500 capitalize">{p.type}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${
                      p.status === "completed" || p.status === "success" ? "bg-green-100 text-green-700" :
                      p.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                    }`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{p.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-50">
          {payments.map((p) => (
            <div key={p.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold text-gray-900">{p.restaurant}</p>
                <p className="text-xs text-gray-400 shrink-0">{p.date}</p>
              </div>
              <p className="font-mono text-xs text-gray-500">{p.ref}</p>
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-gray-900">₦{p.amount.toLocaleString("en-NG")}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 capitalize">{p.type}</span>
                  <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${
                    p.status === "completed" || p.status === "success" ? "bg-green-100 text-green-700" :
                    p.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                  }`}>{p.status}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        {payments.length === 0 && (
          <div className="py-16 text-center text-gray-400 text-sm">No payments recorded yet.</div>
        )}
      </div>
    </div>
  );
}
