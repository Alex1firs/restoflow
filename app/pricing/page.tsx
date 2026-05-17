import Link from "next/link";
import PublicNav from "@/app/components/PublicNav";
import { PLANS } from "@/lib/plans";
import { CheckCircle2 } from "lucide-react";

const PLAN = PLANS[0];

export default function PricingPage() {
  return (
    <div className="bg-black text-white min-h-screen">
      <PublicNav />

      <section className="pt-32 pb-20 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-14">
            <h1 className="text-5xl font-black italic uppercase tracking-tighter mb-4">
              Simple, honest <span className="text-orange-500">pricing</span>
            </h1>
            <p className="text-gray-400 max-w-lg mx-auto">
              One plan. Everything included. Cancel anytime.
            </p>
          </div>

          {/* Single plan card */}
          <div className="relative rounded-3xl border border-orange-500 bg-orange-500/5 p-10">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs font-black uppercase px-5 py-1.5 rounded-full shadow-lg shadow-orange-500/20">
              Restaflow Pro
            </div>

            <div className="text-center mb-8">
              <div className="mt-4 mb-1">
                <span className="text-6xl font-black text-white">
                  ₦{PLAN.monthlyPrice.toLocaleString()}
                </span>
                <span className="text-gray-400 text-lg ml-2">/month</span>
              </div>
              <p className="text-gray-500 text-sm">7-day free trial · No credit card required</p>
            </div>

            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
              {PLAN.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="text-orange-500 shrink-0 mt-0.5" size={16} />
                  <span className="text-gray-200">{feature}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/get-started"
              className="block text-center font-black text-base py-4 rounded-xl bg-orange-500 hover:bg-orange-400 text-white transition"
            >
              Start Free Trial →
            </Link>
          </div>

          {/* FAQ notes */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h3 className="font-black text-white mb-2">Is there a free trial?</h3>
              <p className="text-gray-400">
                Yes. Every new account gets a 7-day free trial with full access to all features. No
                credit card required.
              </p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h3 className="font-black text-white mb-2">When do I pay?</h3>
              <p className="text-gray-400">
                After your 7-day trial you are billed ₦19,999/month. Cancel before the trial ends
                and you will never be charged.
              </p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h3 className="font-black text-white mb-2">Can I cancel?</h3>
              <p className="text-gray-400">
                Yes. Cancel anytime from your dashboard. You keep access until the end of the
                billing period.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-4 py-8 text-center text-gray-600 text-sm">
        © {new Date().getFullYear()} RestoFlow · Built for Nigerian restaurants
      </footer>
    </div>
  );
}
