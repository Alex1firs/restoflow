"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, PlayCircle, Smartphone, Store, ShieldCheck, Zap, Globe, RefreshCcw, TrendingUp } from "lucide-react";
import PublicNav from "./components/PublicNav";
import { HeroDashboardMockup, MobileOrderMockup } from "./components/LandingMockups";
import Footer from "./components/Footer";
import { PLANS } from "@/lib/plans";

const FEATURES = [
  {
    icon: <Smartphone className="text-orange-500" size={24} />,
    title: "Instant Table Ordering",
    body: "Customers scan and order in seconds. Beautiful mobile menus that convert better than physical ones.",
  },
  {
    icon: <Zap className="text-orange-500" size={24} />,
    title: "Direct Online Payments",
    body: "Accept restaurant-owned payments instantly. Money hits your account directly. No delayed payouts.",
  },
  {
    icon: <Store className="text-orange-500" size={24} />,
    title: "Live Kitchen Dashboard",
    body: "Track every order in real time. Update status from pending to ready and notify customers instantly.",
  },
  {
    icon: <RefreshCcw className="text-orange-500" size={24} />,
    title: "No More WhatsApp Chaos",
    body: "Centralize orders professionally. Stop losing orders in DMs and automate your entire process.",
  },
];

const TRUST_LOGOS = [
  { name: "Grills Capitol" },
  { name: "Smokeyard" },
  { name: "Bargs" },
];

export default function LandingPage() {
  const scrollToDemo = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById("demo-section")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="bg-[#050505] text-[#EDEDED] min-h-screen selection:bg-orange-500/30 selection:text-white">
      <div className="absolute inset-0 mesh-bg opacity-40 pointer-events-none" />
      
      <PublicNav />

      {/* 1. HERO SECTION */}
      <section className="relative pt-32 lg:pt-40 pb-20 px-4 overflow-hidden">
        <div className="max-w-7xl mx-auto relative z-10 grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-left"
          >
            <div className="inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
              </span>
              Restaurant Operating System
            </div>
            
            <h1 className="text-5xl lg:text-7xl font-black uppercase tracking-tighter leading-[1.05] mb-6">
              Take Your <br className="hidden lg:block" />
              Restaurant <br className="hidden lg:block" />
              <span className="bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent italic pr-2">
                Online.
              </span>
              <br />
              Without the Chaos.
            </h1>
            
            <p className="text-white/60 text-lg md:text-xl max-w-xl mb-10 leading-relaxed font-light">
              Accept orders, manage operations, receive payments, and grow your restaurant with a modern all-in-one digital platform built for Nigerian restaurants.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/get-started"
                className="group relative bg-orange-500 hover:bg-orange-400 text-white font-bold text-base px-8 py-4 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 glow-orange"
              >
                Start Free Trial
                <ArrowRight className="group-hover:translate-x-1 transition-transform" size={18} />
              </Link>
              <button
                onClick={scrollToDemo}
                className="glass hover:bg-white/5 border border-white/10 text-white font-medium text-base px-8 py-4 rounded-xl transition flex items-center justify-center gap-2"
              >
                <PlayCircle size={18} />
                Watch Demo
              </button>
            </div>
          </motion.div>

          <div className="relative w-full">
            <HeroDashboardMockup />
          </div>

        </div>
      </section>

      {/* 2. TRUST SECTION */}
      <section className="py-12 border-y border-white/5 bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-8">
            Built for Modern Nigerian Restaurants
          </p>
          <div className="flex flex-wrap justify-center gap-x-12 gap-y-6 items-center opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
            {TRUST_LOGOS.map((logo) => (
              <div key={logo.name} className="text-xl font-black uppercase tracking-widest text-white">
                {logo.name}
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-white/50 font-medium">
            <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-orange-500" /> QR Ordering</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-orange-500" /> Direct Payments</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-orange-500" /> WhatsApp Integration</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-orange-500" /> Real-time Sync</span>
          </div>
        </div>
      </section>

      {/* 3. FEATURES SECTION */}
      <section className="py-24 px-4 relative">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter mb-4">
              Everything you need. <br />
              <span className="text-orange-500 italic">Nothing you don&apos;t.</span>
            </h2>
            <p className="text-white/50 text-lg">
              A powerful suite of tools designed to replace your messy spreadsheets and chaotic WhatsApp DMs.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((f, i) => (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                key={f.title}
                className="group relative glass rounded-2xl p-6 hover:border-orange-500/30 transition-colors duration-300"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-orange-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-6">
                    {f.icon}
                  </div>
                  <h3 className="text-lg font-bold text-white mb-3">{f.title}</h3>
                  <p className="text-white/60 text-sm leading-relaxed">{f.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. PRODUCT PREVIEW SECTION */}
      <section id="demo-section" className="py-24 px-4 border-t border-white/5 bg-white/[0.01] overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="text-left"
            >
              <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-6">
                See RestoFlow In Action
              </div>
              <h2 className="text-4xl lg:text-5xl font-black uppercase tracking-tighter mb-6">
                Your menu, <span className="italic text-orange-500">beautifully</span> on their phones.
              </h2>
              <p className="text-white/60 text-lg mb-8 leading-relaxed">
                Give your customers a world-class ordering experience. They scan a QR code on the table, browse high-res photos of your food, and pay directly. The order pops up on your kitchen dashboard instantly.
              </p>
              
              <ul className="space-y-4">
                {[
                  "No app downloads required",
                  "Apple Pay & Card payments supported",
                  "Automated receipt generation",
                  "Add table numbers automatically"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-white/80 font-medium">
                    <CheckCircle2 className="text-orange-500" size={18} />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>

            <div className="relative">
              <MobileOrderMockup />
            </div>
          </div>
        </div>
      </section>

      {/* 5. WHY CHOOSE RESTOFLOW */}
      <section className="py-24 px-4 border-t border-white/5 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-orange-500/5 to-transparent opacity-30 pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter mb-6">
            Why Restaurants Choose <span className="text-orange-500 italic">RestoFlow</span>
          </h2>
          <p className="text-white/60 text-lg mb-16">
            Stop relying solely on expensive third-party platforms. Build your own digital infrastructure and own your customer relationships.
          </p>

          <div className="grid md:grid-cols-3 gap-8 text-left">
            <div className="glass p-6 rounded-2xl">
              <ShieldCheck className="text-orange-500 mb-4" size={32} />
              <h3 className="text-xl font-bold text-white mb-2">Zero Commission</h3>
              <p className="text-white/50 text-sm">Keep 100% of your profits. Stop paying 20-30% cuts to delivery apps on every single order.</p>
            </div>
            <div className="glass p-6 rounded-2xl">
              <Globe className="text-orange-500 mb-4" size={32} />
              <h3 className="text-xl font-bold text-white mb-2">Own Your Brand</h3>
              <p className="text-white/50 text-sm">Your logo, your colors, your menu. Provide a premium, standalone experience to your diners.</p>
            </div>
            <div className="glass p-6 rounded-2xl">
              <TrendingUp className="text-orange-500 mb-4" size={32} />
              <h3 className="text-xl font-bold text-white mb-2">Instant Cash Flow</h3>
              <p className="text-white/50 text-sm">Payments go directly to your Paystack account. No waiting weeks for platform payouts.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. PRICING SECTION */}
      <section className="py-24 px-4 border-t border-white/5 bg-white/[0.01]">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black italic uppercase tracking-tighter mb-4">
              Simple, transparent <span className="text-orange-500">pricing</span>
            </h2>
            <p className="text-white/60 text-lg">
              Recover lost orders. Reduce manual work. Increase repeat customers.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative rounded-3xl p-10 bg-white/[0.05] border border-orange-500 glow-orange"
          >
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs font-black uppercase tracking-wider px-5 py-1.5 rounded-full shadow-lg shadow-orange-500/20">
              Restaflow Pro
            </div>

            <div className="text-center mb-8">
              <div className="flex items-end justify-center gap-1 mb-1">
                <span className="text-5xl font-black text-white">₦{PLANS[0].monthlyPrice.toLocaleString()}</span>
                <span className="text-white/40 text-lg mb-1">/mo</span>
              </div>
              <p className="text-orange-400/80 text-sm font-medium">7-day free trial · No credit card required</p>
            </div>

            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
              {PLANS[0].features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-white/70 font-medium">
                  <CheckCircle2 className="text-orange-500 shrink-0 mt-0.5" size={16} />
                  {f}
                </li>
              ))}
            </ul>

            <Link
              href="/get-started"
              className="block text-center font-bold text-base py-4 rounded-xl bg-orange-500 hover:bg-orange-400 text-white transition-all shadow-lg shadow-orange-500/20"
            >
              Start Free Trial →
            </Link>
          </motion.div>
        </div>
      </section>

      {/* 7. FINAL CTA */}
      <section className="py-32 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-orange-500/10 to-transparent pointer-events-none" />
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <h2 className="text-5xl md:text-6xl font-black italic uppercase tracking-tighter mb-6">
            Ready to upgrade <br /> your <span className="text-orange-500">operations?</span>
          </h2>
          <p className="text-white/60 text-lg md:text-xl mb-10 font-light">
            Join the premium Nigerian restaurants saving hours of manual work every week. Set up takes less than 24 hours.
          </p>
          <Link
            href="/get-started"
            className="inline-flex bg-orange-500 hover:bg-orange-400 text-white font-black text-lg px-12 py-5 rounded-2xl transition-all duration-300 items-center justify-center gap-2 glow-orange hover:scale-105"
          >
            Get Started For Free
            <ArrowRight size={20} />
          </Link>
          <p className="text-white/40 text-sm mt-6">7-day free trial. No credit card required.</p>
        </div>
      </section>

      {/* 8. FOOTER */}
      <Footer />
    </div>
  );
}
