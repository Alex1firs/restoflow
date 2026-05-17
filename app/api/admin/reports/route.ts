import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { getAdminDb } from "@/lib/firebase-admin";

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date) { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function toCSV(orders: ReturnType<typeof formatOrders>): string {
  const cols = ["Order ID", "Date", "Customer Name", "Phone", "Items", "Subtotal", "Delivery Fee", "Total", "Payment Method", "Payment Status", "Order Status", "Delivery Type", "Order Source"];
  const rows = orders.map((o) => [
    o.orderId, o.date, o.customerName, o.phone,
    `"${o.items}"`,
    o.itemsTotal, o.deliveryFee, o.total,
    o.paymentMethod, o.paymentStatus, o.status, o.deliveryType, o.orderSource,
  ].join(","));
  return [cols.join(","), ...rows].join("\n");
}

function formatOrders(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
  return docs.map((doc) => {
    const d = doc.data();
    const ts = d.createdAt;
    const date = ts ? (ts.toDate ? ts.toDate() : new Date((ts.seconds ?? 0) * 1000)) : new Date();
    const items = Array.isArray(d.items) ? (d.items as { name: string; quantity: number }[]).map((i) => `${i.quantity}x ${i.name}`).join(", ") : "";
    return {
      orderId: doc.id,
      date: date.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      customerName: (d.customerName as string) ?? "",
      phone: (d.phone as string) ?? "",
      items,
      itemsTotal: (d.itemsTotal as number) ?? 0,
      deliveryFee: (d.deliveryFee as number) ?? 0,
      total: (d.total as number) ?? 0,
      paymentMethod: (d.paymentMethod as string) ?? "",
      paymentStatus: (d.paymentStatus as string) ?? "",
      status: (d.status as string) ?? "",
      deliveryType: (d.deliveryType as string) ?? "",
      orderSource: (d.orderSource as string) ?? "online",
      createdAt: date,
    };
  });
}

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try { user = await getAuthenticatedUser(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  if (user.role === "staff") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") ?? "today";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const exportFormat = searchParams.get("export");

  const now = new Date();
  let startDate: Date;
  let endDate: Date = endOfDay(now);

  switch (range) {
    case "week":
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      startDate = startOfDay(startDate);
      break;
    case "month":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "custom":
      if (!from || !to) return NextResponse.json({ error: "from and to required for custom range" }, { status: 400 });
      startDate = startOfDay(new Date(from));
      endDate = endOfDay(new Date(to));
      break;
    default:
      startDate = startOfDay(now);
  }

  const db = getAdminDb();
  const snap = await db
    .collection("orders")
    .where("restaurantId", "==", user.restaurantSlug)
    .where("createdAt", ">=", startDate)
    .where("createdAt", "<=", endDate)
    .orderBy("createdAt", "desc")
    .get();

  const orders = formatOrders(snap.docs);

  if (exportFormat === "csv") {
    const csv = toCSV(orders);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="orders-${range}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const totalOrders = orders.length;
  const completed = orders.filter((o) => o.status === "completed").length;
  const cancelled = orders.filter((o) => o.status === "rejected").length;
  const onlineTotal = orders.filter((o) => o.paymentMethod === "online" && o.paymentStatus === "paid").reduce((s, o) => s + o.total, 0);
  const cashTotal = orders.filter((o) => o.paymentMethod === "cash").reduce((s, o) => s + o.total, 0);
  const counterTotal = orders.filter((o) => o.orderSource === "counter").reduce((s, o) => s + o.total, 0);
  const bankTransferTotal = orders.filter((o) => o.paymentMethod === "bank_transfer").reduce((s, o) => s + o.total, 0);
  const cardTotal = orders.filter((o) => o.paymentMethod === "card").reduce((s, o) => s + o.total, 0);
  const unpaidTotal = orders.filter((o) => o.paymentStatus === "unpaid" || o.paymentStatus === "part_paid").reduce((s, o) => s + o.total, 0);
  const onlineOrdersCount = orders.filter((o) => o.orderSource !== "counter").length;
  const counterOrdersCount = orders.filter((o) => o.orderSource === "counter").length;

  const itemCounts: Record<string, { name: string; count: number; revenue: number }> = {};
  for (const order of snap.docs) {
    const d = order.data();
    if (Array.isArray(d.items)) {
      for (const item of d.items as { name: string; quantity: number; price: number }[]) {
        if (!itemCounts[item.name]) itemCounts[item.name] = { name: item.name, count: 0, revenue: 0 };
        itemCounts[item.name].count += item.quantity;
        itemCounts[item.name].revenue += item.price * item.quantity;
      }
    }
  }

  const bestSellers = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 10);

  return NextResponse.json({
    summary: {
      totalRevenue,
      totalOrders,
      completed,
      cancelled,
      onlineTotal,
      cashTotal,
      counterTotal,
      bankTransferTotal,
      cardTotal,
      unpaidTotal,
      onlineOrdersCount,
      counterOrdersCount,
    },
    orders: orders.map(({ createdAt: _, ...rest }) => rest),
    bestSellers,
  });
}
