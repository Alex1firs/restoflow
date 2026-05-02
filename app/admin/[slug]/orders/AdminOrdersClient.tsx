"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  updateDoc, 
  doc,
  Timestamp 
} from "firebase/firestore";

type OrderItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

type Order = {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  note: string;
  items: OrderItem[];
  total: number;
  status: "pending" | "preparing" | "completed";
  paymentMethod?: "online" | "cash";
  paymentStatus?: "paid" | "pending";
  paymentReference?: string;
  createdAt: Timestamp;
};

type Props = {
  restaurant: {
    id: string;
    name: string;
    slug: string;
  };
};

export default function AdminOrdersClient({ restaurant }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);

  const fetchOrders = () => {
    setLoading(true);
    const q = query(
      collection(db, "orders"),
      where("restaurantId", "==", restaurant.slug),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      })) as Order[];
      setOrders(ordersData);
      setLoading(false);
    }, (error) => {
      console.error("Firestore real-time error:", error);
      setLoading(false);
    });

    return unsubscribe;
  };

  useEffect(() => {
    const unsubscribe = fetchOrders();
    return () => unsubscribe();
  }, [restaurant.slug]);

  const updateStatus = async (orderId: string, currentStatus: string) => {
    let nextStatus: Order["status"];
    if (currentStatus === "pending") nextStatus = "preparing";
    else if (currentStatus === "preparing") nextStatus = "completed";
    else return;

    setIsUpdating(orderId);
    try {
      const orderRef = doc(db, "orders", orderId);
      await updateDoc(orderRef, { status: nextStatus });
    } catch (error) {
      console.error("Failed to update status:", error);
      alert("Error updating status. Please try again.");
    } finally {
      setIsUpdating(null);
    }
  };

  const formatDate = (timestamp: Timestamp) => {
    if (!timestamp) return "Just now";
    return timestamp.toDate().toLocaleString([], { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "preparing": return "bg-blue-100 text-blue-800 border-blue-200";
      case "completed": return "bg-green-100 text-green-800 border-green-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <header className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-3xl font-black text-gray-900">{restaurant.name} Admin</h1>
          <p className="text-gray-500 font-medium">Order Management Dashboard</p>
        </div>
        <button 
          onClick={() => window.location.reload()}
          className="bg-white border text-gray-600 hover:text-black hover:border-black px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          Manual Refresh
        </button>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border shadow-sm">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mb-4"></div>
          <p className="text-gray-400 font-bold">Synchronizing orders...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
          <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">No orders found</h2>
          <p className="text-gray-500">New orders will appear here automatically.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {orders.map((order) => (
            <div key={order.id} className="bg-white border rounded-3xl shadow-sm overflow-hidden transition-all hover:shadow-md">
              <div className="flex flex-col md:flex-row">
                {/* Left Side: Order Info */}
                <div className="p-6 md:w-2/3 border-b md:border-b-0 md:border-r">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Order Ref</span>
                      <h3 className="font-mono text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded inline-block">{order.id}</h3>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Time</span>
                      <p className="text-sm font-bold text-gray-700">{formatDate(order.createdAt)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                    <div>
                      <h4 className="text-sm font-black text-gray-400 uppercase tracking-wider mb-3">Customer</h4>
                      <p className="font-bold text-gray-900 text-lg">{order.customerName}</p>
                      <p className="text-sm text-gray-600 mb-1">{order.phone}</p>
                      <p className="text-sm text-gray-500 leading-relaxed italic">{order.address}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-gray-400 uppercase tracking-wider mb-3">Items</h4>
                      <div className="space-y-2">
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-sm">
                            <span className="font-medium text-gray-700"><span className="font-black text-orange-600">{item.quantity}x</span> {item.name}</span>
                            <span className="text-gray-400">₦{item.price.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {order.note && (
                    <div className="bg-yellow-50 border border-yellow-100 p-4 rounded-2xl mb-4">
                      <span className="text-[10px] font-black text-yellow-700 uppercase tracking-wider block mb-1">Customer Note</span>
                      <p className="text-sm text-yellow-800">{order.note}</p>
                    </div>
                  )}
                </div>

                {/* Right Side: Status & Action */}
                <div className="p-6 md:w-1/3 bg-gray-50 flex flex-col justify-between items-center text-center">
                  <div className="w-full">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Current Status</span>
                    <span className={`inline-block px-4 py-1.5 rounded-full text-xs font-black uppercase border ${getStatusBadge(order.status)}`}>
                      {order.status}
                    </span>
                  </div>

                  <div className="w-full mt-6">
                    {/* Payment info */}
                    <div className="mb-4 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-400 font-bold uppercase tracking-wide">Payment</span>
                        <span className={`font-black uppercase px-2 py-0.5 rounded-full text-[10px] ${
                          order.paymentMethod === "online"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        }`}>
                          {order.paymentMethod === "online" ? "Online" : "Cash"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-400 font-bold uppercase tracking-wide">Status</span>
                        <span className={`font-black uppercase px-2 py-0.5 rounded-full text-[10px] ${
                          order.paymentStatus === "paid"
                            ? "bg-green-100 text-green-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}>
                          {order.paymentStatus === "paid" ? "Paid" : "Pending"}
                        </span>
                      </div>
                      {order.paymentReference && (
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-400 font-bold uppercase tracking-wide">Ref</span>
                          <span className="font-mono text-gray-500 text-[10px] truncate max-w-[120px]">{order.paymentReference}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between items-center mb-6">
                      <span className="text-sm font-bold text-gray-400">Total</span>
                      <span className="text-2xl font-black text-gray-900">₦{order.total.toFixed(2)}</span>
                    </div>

                    {order.status !== "completed" ? (
                      <button 
                        onClick={() => updateStatus(order.id, order.status)}
                        disabled={isUpdating === order.id}
                        className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-wider transition-all transform active:scale-95 shadow-lg ${
                          order.status === "pending" 
                            ? "bg-blue-600 hover:bg-blue-700 text-white" 
                            : "bg-green-600 hover:bg-green-700 text-white"
                        } ${isUpdating === order.id ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        {isUpdating === order.id 
                          ? "Updating..." 
                          : order.status === "pending" 
                            ? "Mark as Preparing" 
                            : "Mark as Completed"
                        }
                      </button>
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-green-600 font-bold">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                        Order Fulfilled
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
