"use client";

import { motion } from "framer-motion";
import { 
  ChefHat, 
  Clock, 
  TrendingUp, 
  Bell, 
  Search,
  LayoutDashboard,
  UtensilsCrossed,
  Settings,
  CreditCard
} from "lucide-react";

export function HeroDashboardMockup() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 40, rotateX: 10 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className="relative w-full max-w-2xl mx-auto md:mx-0 aspect-[4/3] rounded-2xl border border-white/10 glass overflow-hidden shadow-2xl shadow-orange-500/10 bg-[#0A0A0A]/80 backdrop-blur-xl"
      style={{ perspective: "1000px" }}
    >
      {/* Top Header */}
      <div className="h-12 border-b border-white/10 flex items-center px-4 justify-between bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>
        <div className="flex items-center gap-3 text-white/40">
          <Search size={14} />
          <Bell size={14} />
          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-orange-500 to-orange-300" />
        </div>
      </div>

      <div className="flex h-[calc(100%-3rem)]">
        {/* Sidebar */}
        <div className="w-48 border-r border-white/10 p-4 flex flex-col gap-2 bg-white/[0.01] hidden sm:flex">
          <div className="flex items-center gap-2 text-white/90 font-medium text-sm mb-4 px-2">
            <div className="w-6 h-6 rounded bg-orange-500 flex items-center justify-center">
              <ChefHat size={14} className="text-white" />
            </div>
            RestoFlow
          </div>
          
          <div className="flex items-center gap-2 text-orange-500 bg-orange-500/10 px-3 py-2 rounded-lg text-xs font-medium">
            <LayoutDashboard size={14} />
            Overview
          </div>
          <div className="flex items-center gap-2 text-white/50 hover:text-white/80 px-3 py-2 rounded-lg text-xs font-medium transition-colors">
            <Clock size={14} />
            Live Orders
          </div>
          <div className="flex items-center gap-2 text-white/50 hover:text-white/80 px-3 py-2 rounded-lg text-xs font-medium transition-colors">
            <UtensilsCrossed size={14} />
            Menu
          </div>
          <div className="flex items-center gap-2 text-white/50 hover:text-white/80 px-3 py-2 rounded-lg text-xs font-medium transition-colors">
            <CreditCard size={14} />
            Payments
          </div>
          <div className="mt-auto flex items-center gap-2 text-white/50 hover:text-white/80 px-3 py-2 rounded-lg text-xs font-medium transition-colors">
            <Settings size={14} />
            Settings
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-6 flex flex-col gap-6 overflow-hidden">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="glass rounded-xl p-4 border border-white/5 bg-white/[0.02]">
              <div className="text-white/50 text-xs font-medium mb-1">Today&apos;s Revenue</div>
              <div className="flex items-end gap-2">
                <div className="text-xl font-bold text-white">₦245,000</div>
                <div className="text-green-400 text-[10px] flex items-center mb-1">
                  <TrendingUp size={10} className="mr-0.5" /> +12%
                </div>
              </div>
            </div>
            <div className="glass rounded-xl p-4 border border-white/5 bg-white/[0.02]">
              <div className="text-white/50 text-xs font-medium mb-1">Active Orders</div>
              <div className="flex items-end gap-2">
                <div className="text-xl font-bold text-white">14</div>
                <div className="text-orange-400 text-[10px] flex items-center mb-1">
                  <Clock size={10} className="mr-0.5" /> 4 preparing
                </div>
              </div>
            </div>
          </div>

          {/* Active Orders List */}
          <div className="flex-1 glass rounded-xl border border-white/5 bg-white/[0.02] p-4 overflow-hidden flex flex-col">
            <div className="text-sm font-medium text-white/90 mb-4 flex items-center justify-between">
              Live Kitchen Queue
              <span className="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded text-[10px]">Real-time</span>
            </div>
            
            <div className="flex flex-col gap-3">
              {[
                { id: "#1042", items: "2x Jollof Rice, 1x Plantain", time: "2 min ago", status: "New", color: "text-blue-400", bg: "bg-blue-400/10" },
                { id: "#1041", items: "1x Grilled Chicken, 1x Coke", time: "8 min ago", status: "Preparing", color: "text-orange-400", bg: "bg-orange-400/10" },
                { id: "#1040", items: "3x Beef Suya, 2x Fanta", time: "15 min ago", status: "Ready", color: "text-green-400", bg: "bg-green-400/10" },
              ].map((order, i) => (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + (i * 0.1) }}
                  key={order.id} 
                  className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.05] transition-colors"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium text-xs">{order.id}</span>
                      <span className="text-white/40 text-[10px]">{order.time}</span>
                    </div>
                    <span className="text-white/60 text-[11px] truncate max-w-[150px]">{order.items}</span>
                  </div>
                  <div className={`px-2 py-1 rounded text-[10px] font-medium ${order.color} ${order.bg}`}>
                    {order.status}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Decorative Glow */}
      <div className="absolute -top-20 -right-20 w-64 h-64 bg-orange-500/20 blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-blue-500/10 blur-[100px] rounded-full pointer-events-none" />
    </motion.div>
  );
}

export function MobileOrderMockup() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.6 }}
      className="relative w-64 h-[500px] mx-auto rounded-[2.5rem] border-[6px] border-[#1A1A1A] bg-[#0A0A0A] overflow-hidden shadow-2xl shadow-orange-500/20"
    >
      {/* Notch */}
      <div className="absolute top-0 inset-x-0 h-6 flex justify-center z-20">
        <div className="w-24 h-5 bg-[#1A1A1A] rounded-b-xl" />
      </div>

      {/* Screen Content */}
      <div className="h-full w-full overflow-hidden flex flex-col bg-[#0A0A0A] relative z-10">
        {/* Header Image */}
        <div className="h-32 bg-white/5 relative">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0A0A0A]" />
          <div className="absolute bottom-4 left-4">
            <h3 className="text-white font-bold text-lg">Grills Capitol</h3>
            <p className="text-white/60 text-xs">Table 12 • Open</p>
          </div>
        </div>

        {/* Menu Items */}
        <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto pb-20 no-scrollbar">
          {[
            { name: "Smokey Jollof", price: "₦4,500", desc: "Served with plantain", add: true },
            { name: "Grilled Chicken", price: "₦3,000", desc: "Spicy quarter chicken", add: false },
            { name: "Beef Suya", price: "₦2,000", desc: "Authentic yaji spice", add: false },
            { name: "Chilled Coke", price: "₦800", desc: "50cl pet bottle", add: true },
          ].map((item, i) => (
            <div key={i} className="flex gap-3 pb-4 border-b border-white/5">
              <div className="w-16 h-16 rounded-lg bg-white/10 flex-shrink-0" />
              <div className="flex-1 flex flex-col justify-center">
                <div className="text-white text-sm font-medium">{item.name}</div>
                <div className="text-white/50 text-[10px] mb-1">{item.desc}</div>
                <div className="text-orange-400 text-xs font-bold">{item.price}</div>
              </div>
              <div className="flex items-center justify-center">
                {item.add ? (
                  <div className="w-6 h-6 rounded bg-orange-500 flex items-center justify-center text-white text-sm font-bold">
                    +
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded border border-white/20 flex items-center justify-center text-white/50 text-sm">
                    +
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Sticky Cart */}
        <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A] to-transparent">
          <div className="bg-orange-500 rounded-xl p-3 flex items-center justify-between text-white shadow-lg shadow-orange-500/20">
            <div className="flex items-center gap-2">
              <div className="bg-white/20 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">
                2
              </div>
              <span className="text-sm font-medium">View Cart</span>
            </div>
            <span className="text-sm font-bold">₦5,300</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
