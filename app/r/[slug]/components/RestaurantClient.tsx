"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { useCart } from "./CartContext";

type View = "home" | "menu" | "cart" | "checkout" | "success";

interface MenuItemData {
  id: string;
  name: string;
  price: number;
  category: string;
  available: boolean;
  description: string;
  image?: string;
  restaurantId: string;
}

interface RestaurantClientProps {
  restaurant: {
    name: string;
    description: string;
    coverImage: string;
    slug: string;
  };
  menuItems: MenuItemData[];
  initialView?: View;
}

export default function RestaurantClient({ 
  restaurant, 
  menuItems, 
  initialView = "home" 
}: RestaurantClientProps) {
  const [view, setView] = useState<View>(initialView);
  const [isHydrated, setIsHydrated] = useState(false);
  const { items, addToCart, updateQuantity, totalPrice, clearCart } = useCart();

  // Form State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    customerName: "",
    phone: "",
    address: "",
    note: ""
  });

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const handleSetView = (newView: View) => {
    setView(newView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const validateForm = () => {
    return formData.customerName && formData.phone && formData.address;
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (items.length === 0) {
      return;
    }

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const orderData = {
        restaurantId: restaurant.slug,
        customerName: formData.customerName,
        phone: formData.phone,
        address: formData.address,
        note: formData.note,
        items: items,
        total: totalPrice,
        status: "pending",
        createdAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, "orders"), orderData);
      setOrderId(docRef.id);
      
      clearCart();
      setFormData({ customerName: "", phone: "", address: "", note: "" });
      handleSetView("success");
    } catch (err) {
      console.error("Order submission failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const liveMenuItems = menuItems || [];

  return (
    <div 
      className="min-h-screen bg-gray-900 text-white font-sans selection:bg-orange-500/30 overflow-x-hidden flex flex-col"
    >
      {/* Sticky Navigation */}
      <nav className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-white/5 px-4 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <button 
            onClick={() => handleSetView("home")}
            className="text-2xl font-black italic tracking-tighter hover:text-orange-500 transition-colors uppercase"
          >
            {restaurant.name}
          </button>
          
          <div className="flex items-center gap-2 md:gap-4">
            <button 
              onClick={() => handleSetView("home")} 
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'home' ? 'bg-white/10 text-orange-500' : 'text-gray-400 hover:text-white'}`}
            >
              Home
            </button>
            <button 
              onClick={() => handleSetView("menu")} 
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${view === 'menu' ? 'bg-white/10 text-orange-500' : 'text-gray-400 hover:text-white'}`}
            >
              Menu
            </button>
            <button 
              onClick={() => handleSetView("cart")}
              className="relative group bg-orange-600 hover:bg-orange-500 p-2.5 rounded-xl transition-all shadow-lg shadow-orange-600/20 active:scale-95"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path>
              </svg>
              {items.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-white text-orange-600 text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-orange-600 animate-pulse">
                  {items.reduce((acc, item) => acc + item.quantity, 0)}
                </span>
              )}
            </button>
          </div>
        </div>
      </nav>

      <main 
        className={`${view === 'home' ? 'pb-24' : 'pb-12'} relative z-10 flex-1`}
      >
        {!isHydrated && (
          <div className="bg-orange-600/10 border-b border-orange-600/20 text-orange-500 p-2 text-center text-[10px] font-black uppercase tracking-widest">
            Establishing Secure Sync... (Wait for Hydration)
          </div>
        )}

        {/* QR Menu Mode Header */}
        {view === "menu" && (
          <div className="bg-gray-900 border-b border-white/5 py-12 px-6 text-center z-10 relative">
            <h1 className="text-4xl md:text-6xl font-black italic tracking-tighter uppercase text-white">
              {restaurant.name} <span className="text-orange-600">Menu</span>
            </h1>
            <p className="text-gray-500 mt-4 font-bold uppercase tracking-widest text-[10px]">Direct Kitchen Access</p>
          </div>
        )}

        {/* Home View */}
        {view === "home" && (
          <div className="relative h-[85vh] w-full flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 z-0">
              <img 
                src={(restaurant.coverImage && !restaurant.coverImage.includes('placehold.co')) ? restaurant.coverImage : "https://images.unsplash.com/photo-1544025162-d76694265947?w=1600&auto=format"} 
                alt={restaurant.name} 
                className="w-full h-full object-cover" 
              />
              {/* Layered Cinematic Gradients */}
              <div className="absolute inset-0 bg-gradient-to-b from-gray-900/60 via-gray-900/40 to-gray-900"></div>
              <div className="absolute inset-0 bg-gradient-to-r from-gray-900/40 via-transparent to-gray-900/40"></div>
              <div className="absolute inset-0 bg-black/20"></div>
            </div>
            
            <div className="relative z-10 max-w-6xl mx-auto px-6 text-center pointer-events-auto">
              <div className="mb-10 inline-flex items-center gap-2 bg-white/5 backdrop-blur-xl border border-white/10 px-6 py-2 rounded-full shadow-2xl animate-pulse">
                <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/80">Direct Kitchen Sync Active</span>
              </div>

              <h1 className="text-7xl md:text-9xl font-black mb-8 text-white italic tracking-tighter uppercase leading-[0.8] drop-shadow-2xl">
                {restaurant.name}
              </h1>
              
              <p className="text-xl md:text-2xl text-gray-200 mb-14 max-w-2xl mx-auto font-medium leading-tight opacity-90 drop-shadow-lg uppercase tracking-tight italic">
                {restaurant.description || "Experience the finest culinary delights crafted with passion and served with excellence."}
              </p>

              <button 
                onClick={() => handleSetView("menu")}
                className="group relative bg-orange-600 hover:bg-orange-500 text-white font-black py-7 px-16 rounded-3xl transition-all transform hover:scale-105 active:scale-95 shadow-[0_0_50px_rgba(234,88,12,0.3)] hover:shadow-[0_0_80px_rgba(234,88,12,0.5)] text-2xl uppercase tracking-[0.1em]"
              >
                <span className="relative z-10">Start Your Order</span>
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-orange-400 to-orange-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </button>
            </div>
          </div>
        )}

        {/* Menu View */}
        {view === "menu" && (
          <div className="p-6 max-w-6xl mx-auto pt-12 relative z-20 pointer-events-auto">
            <div className="text-center mb-16">
              <h2 className="text-5xl md:text-7xl font-black italic tracking-tighter uppercase">Our Menu</h2>
            </div>
            
            {liveMenuItems.length === 0 ? (
              <div className="bg-white/5 border border-dashed border-white/10 rounded-3xl p-20 text-center text-gray-500">
                <p className="text-xl font-bold">Menu is currently empty.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {liveMenuItems.map((item) => {
                  const itemName = item.name.toLowerCase();
                  const itemImage = 
                    (itemName.includes('steak') || itemName.includes('rib')) ? 'https://images.unsplash.com/photo-1600891964599-f61ba0e24092?w=800&auto=format'
                    : itemName.includes('chicken') ? 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=800&auto=format'
                    : itemName.includes('burger') ? 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format'
                    : itemName.includes('frie') ? 'https://images.unsplash.com/photo-1573037153445-5626cc96760e?w=800&auto=format'
                    : itemName.includes('salad') ? 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format'
                    : (itemName.includes('cheesecake') || itemName.includes('dessert') || itemName.includes('cake')) ? 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=800&auto=format'
                    : (itemName.includes('pasta') || itemName.includes('spaghetti')) ? 'https://images.unsplash.com/photo-1516100882582-96c3a05fe590?w=800&auto=format'
                    : (itemName.includes('mac') && itemName.includes('cheese')) ? 'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=800&auto=format'
                    : itemName.includes('asparagus') ? 'https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=800&auto=format'
                    : itemName.includes('potato') ? 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?w=800&auto=format'
                    : itemName.includes('pizza') ? 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format'
                    : (itemName.includes('drink') || itemName.includes('soda') || itemName.includes('juice')) ? 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=800&auto=format'
                    : (item.image && !item.image.includes('placeholder') && !item.image.includes('dummyimage')) ? item.image
                    : 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&auto=format';
                  
                  return (
                    <div key={item.id} className="group bg-gray-800/50 backdrop-blur-md border border-white/5 rounded-[2.5rem] overflow-hidden flex flex-col transition-all hover:scale-[1.02] hover:shadow-2xl hover:shadow-orange-600/10 hover:border-orange-600/30">
                      <div className="relative h-64 overflow-hidden">
                        <img src={itemImage} alt={item.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent opacity-60"></div>
                        <div className="absolute top-4 left-4">
                          <span className="bg-orange-600 text-white text-[10px] font-black uppercase px-4 py-1.5 rounded-full shadow-lg">
                            {item.category}
                          </span>
                        </div>
                        {!item.available && (
                          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                            <span className="text-red-500 font-black text-2xl uppercase italic border-4 border-red-500 px-4 py-1 rounded-xl -rotate-12">Sold Out</span>
                          </div>
                        )}
                      </div>
                      <div className="p-8 flex flex-col flex-1">
                        <div className="flex justify-between items-start mb-4">
                          <h3 className="font-black text-2xl uppercase italic tracking-tighter">{item.name}</h3>
                          <span className="font-black text-orange-500 text-xl">₦{item.price.toFixed(2)}</span>
                        </div>
                        <p className="text-sm text-gray-400 mb-8 flex-1 leading-relaxed opacity-80">{item.description}</p>
                        <button 
                          disabled={!item.available}
                          onClick={() => {
                            addToCart({ id: item.id, name: item.name, price: item.price });
                          }}
                          className={`w-full py-4 rounded-2xl font-black uppercase text-xs tracking-widest transition-all ${item.available ? "bg-white text-gray-900 hover:bg-orange-600 hover:text-white" : "bg-gray-700 text-gray-500 pointer-events-none"}`}
                        >
                          {item.available ? "Add To Order" : "Sold Out"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Cart View */}
        {view === "cart" && (
          <div className="p-6 max-w-2xl mx-auto relative z-20 pointer-events-auto">
            <h2 className="text-5xl font-black mb-12 italic tracking-tighter uppercase text-center">Your Order</h2>
            {items.length === 0 ? (
              <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-20 text-center">
                <p className="text-gray-400 mb-8 text-lg font-medium italic">Hungry? Your cart looks a bit lonely...</p>
                <button onClick={() => handleSetView("menu")} className="bg-orange-600 text-white font-black py-4 px-10 rounded-2xl uppercase tracking-widest shadow-xl">Back To Menu</button>
              </div>
            ) : (
              <div className="bg-gray-800/30 backdrop-blur-md rounded-[2.5rem] border border-white/5 overflow-hidden">
                <div className="p-8 space-y-6">
                  {items.map(item => (
                    <div key={item.id} className="flex items-center justify-between pb-6 border-b border-white/5 last:border-0 last:pb-0">
                      <div>
                        <h4 className="font-bold text-xl uppercase mb-1">{item.name}</h4>
                        <p className="text-orange-500 font-black">₦{item.price.toFixed(2)}</p>
                      </div>
                      <div className="flex items-center gap-4 bg-white/5 p-2 rounded-2xl">
                        <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-orange-600 rounded-xl transition-all font-black">-</button>
                        <span className="font-black text-xl w-6 text-center italic">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-orange-600 rounded-xl transition-all font-black">+</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-8 bg-orange-600/10 border-t border-white/5">
                  <div className="flex justify-between items-center mb-8">
                    <span className="text-sm font-black uppercase text-gray-400 tracking-widest">Order Total</span>
                    <span className="text-4xl font-black text-orange-600 italic tracking-tighter">₦{totalPrice.toFixed(2)}</span>
                  </div>
                  <button onClick={() => handleSetView("checkout")} className="w-full bg-orange-600 text-white font-black py-6 rounded-2xl text-lg uppercase tracking-widest shadow-xl">Proceed To Checkout</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Checkout View */}
        {view === "checkout" && (
          <div className="p-6 max-w-4xl mx-auto relative z-20 pointer-events-auto">
            <h2 className="text-5xl font-black mb-12 italic tracking-tighter uppercase text-center">Checkout</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <form onSubmit={handlePlaceOrder} className="space-y-6">
                <div className="bg-gray-800/30 backdrop-blur-md p-8 rounded-[2.5rem] border border-white/5 space-y-6">
                  <input 
                    type="text" 
                    placeholder="Full Name" 
                    value={formData.customerName} 
                    onChange={e => setFormData({...formData, customerName: e.target.value})}
                    className="w-full bg-white/5 p-4 rounded-xl border border-white/10 outline-none focus:border-orange-500" 
                  />
                  <input 
                    type="tel" 
                    placeholder="Phone" 
                    value={formData.phone} 
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="w-full bg-white/5 p-4 rounded-xl border border-white/10 outline-none focus:border-orange-500" 
                  />
                  <textarea 
                    placeholder="Address" 
                    value={formData.address} 
                    onChange={e => setFormData({...formData, address: e.target.value})}
                    rows={3} 
                    className="w-full bg-white/5 p-4 rounded-xl border border-white/10 outline-none focus:border-orange-500" 
                  ></textarea>
                </div>
                <button type="submit" disabled={isSubmitting} className="w-full bg-orange-600 text-white font-black py-6 rounded-2xl text-lg uppercase tracking-widest shadow-xl">Confirm Order</button>
              </form>
              <div className="bg-gray-800/30 backdrop-blur-md p-8 rounded-[2.5rem] border border-white/5">
                <h3 className="font-bold text-xl uppercase mb-6">Order Summary</h3>
                <div className="space-y-4 mb-8">
                  {items.map(item => (
                    <div key={item.id} className="flex justify-between">
                      <span className="font-bold">{item.quantity}x {item.name}</span>
                      <span>₦{(item.quantity * item.price).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-white/10 pt-4 flex justify-between font-black">
                  <span>Total</span>
                  <span className="text-2xl text-orange-500">₦{totalPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Success View */}
        {view === "success" && (
          <div className="p-6 max-w-xl mx-auto py-20 text-center relative z-20 pointer-events-auto">
            <div className="bg-orange-600 rounded-[3rem] p-10 text-white inline-block shadow-2xl mb-12">
              <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <h2 className="text-6xl font-black mb-6 italic tracking-tighter uppercase">Success!</h2>
            <p className="text-xl text-gray-400 mb-12 leading-relaxed">Your order has been received and is being prepared!</p>
            <div className="bg-white/5 p-8 rounded-3xl border border-white/10 mb-12">
              <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-2">Order Reference</p>
              <p className="text-lg font-black text-orange-500">{orderId}</p>
            </div>
            <button onClick={() => handleSetView("menu")} className="bg-white text-gray-900 font-black py-6 px-12 rounded-2xl uppercase tracking-widest transition-all hover:bg-orange-600 hover:text-white">Order More</button>
          </div>
        )}
      </main>

      <footer className="mt-auto border-t border-white/5 py-12 px-6">
        <p className="text-[10px] font-medium tracking-widest uppercase text-center opacity-40">© 2026 {restaurant.name} Operations.</p>
      </footer>
    </div>
  );
}
