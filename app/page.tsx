import Link from "next/link";
import PublicNav from "./components/PublicNav";
import { PLANS } from "@/lib/plans";

const FEATURES = [
  {
    icon: "⬛",
    title: "QR Code Ordering",
    body: "Customers scan, browse your menu, and order from their phone. No app, no download, no friction.",
  },
  {
    icon: "💳",
    title: "Online Payments",
    body: "Integrated Paystack payments. Money hits your account directly. No cash handling, no lost orders.",
  },
  {
    icon: "📋",
    title: "Order Dashboard",
    body: "All incoming orders in one real-time view. Update status from pending to preparing to done in one tap.",
  },
  {
    icon: "🚫",
    title: "No More WhatsApp Chaos",
    body: "Stop taking orders over DM. RestoFlow handles everything automatically, professionally, 24/7.",
  },
];

export default function LandingPage() {
  return (
    <div className="bg-black text-white min-h-screen">
      <PublicNav />

      {/* Hero */}
      <section className="pt-32 pb-24 px-4 text-center">
        <div className="max-w-3xl mx-auto">
          <span className="inline-block bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-6">
            Built for Nigerian Restaurants
          </span>
          <h1 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter leading-none mb-6">
            Take Your Restaurant{" "}
            <span className="text-orange-500">Online.</span>
            <br />
            Without the Chaos.
          </h1>
          <p className="text-gray-400 text-lg md:text-xl max-w-xl mx-auto mb-10">
            QR code menus. Online ordering. Real-time dashboard. Everything your
            restaurant needs to stop losing money to manual orders.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/get-started"
              className="bg-orange-500 hover:bg-orange-600 text-white font-black text-base px-8 py-4 rounded-xl transition"
            >
              Start Free Trial →
            </Link>
            <Link
              href="/pricing"
              className="border border-white/20 hover:border-white/40 text-white font-bold text-base px-8 py-4 rounded-xl transition"
            >
              See Pricing
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 border-t border-white/10">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-black italic uppercase tracking-tighter text-center mb-12">
            Everything you need.{" "}
            <span className="text-orange-500">Nothing you don&apos;t.</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-orange-500/30 transition"
              >
                <div className="text-2xl mb-3">{f.icon}</div>
                <h3 className="text-base font-black text-white mb-2">{f.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing preview */}
      <section className="py-20 px-4 border-t border-white/10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-black italic uppercase tracking-tighter mb-3">
              Simple, transparent{" "}
              <span className="text-orange-500">pricing</span>
            </h2>
            <p className="text-gray-400">One setup fee. Monthly subscription. No surprises.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-2xl border p-6 flex flex-col ${
                  plan.popular
                    ? "border-orange-500 bg-orange-500/5"
                    : "border-white/10 bg-white/5"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-[10px] font-black uppercase px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                )}
                <h3 className="font-black text-white text-lg mb-1">{plan.name}</h3>
                <p className="text-3xl font-black text-white mt-2">
                  ₦{plan.monthlyPrice.toLocaleString()}
                  <span className="text-sm font-normal text-gray-400">/mo</span>
                </p>
                <p className="text-xs text-gray-500 mt-1 mb-5">
                  ₦{plan.setupFee.toLocaleString()} setup fee
                </p>
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-orange-500 mt-0.5">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/get-started?plan=${plan.id}`}
                  className={`text-center font-bold text-sm py-3 rounded-xl transition ${
                    plan.popular
                      ? "bg-orange-500 hover:bg-orange-600 text-white"
                      : "border border-white/20 hover:border-white/40 text-white"
                  }`}
                >
                  Choose {plan.name}
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-gray-500 text-sm mt-6">
            All plans include a 14-day free trial. No credit card required to start.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 border-t border-white/10">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl font-black italic uppercase tracking-tighter mb-4">
            Ready to go <span className="text-orange-500">online?</span>
          </h2>
          <p className="text-gray-400 mb-8">
            Set up your restaurant in minutes. Start accepting orders today.
          </p>
          <Link
            href="/get-started"
            className="inline-block bg-orange-500 hover:bg-orange-600 text-white font-black text-base px-10 py-4 rounded-xl transition"
          >
            Get Started Free →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-4 py-8 text-center text-gray-600 text-sm">
        © {new Date().getFullYear()} RestoFlow · Built for Nigerian restaurants
      </footer>
    </div>
  );
}
