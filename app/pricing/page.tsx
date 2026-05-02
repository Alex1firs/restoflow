import Link from "next/link";
import PublicNav from "@/app/components/PublicNav";
import { PLANS } from "@/lib/plans";

export default function PricingPage() {
  return (
    <div className="bg-black text-white min-h-screen">
      <PublicNav />

      <section className="pt-32 pb-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h1 className="text-5xl font-black italic uppercase tracking-tighter mb-4">
              Simple, honest <span className="text-orange-500">pricing</span>
            </h1>
            <p className="text-gray-400 max-w-lg mx-auto">
              Pay once to set up. Pay monthly to keep running. Cancel anytime.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-2xl border p-8 flex flex-col ${
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

                <h2 className="text-xl font-black text-white">{plan.name}</h2>

                <div className="mt-4 mb-2">
                  <span className="text-4xl font-black text-white">
                    ₦{plan.monthlyPrice.toLocaleString()}
                  </span>
                  <span className="text-gray-400 text-sm ml-1">/month</span>
                </div>

                <div className="flex items-center gap-2 mb-6">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                    Setup fee:
                  </span>
                  <span className="text-sm font-bold text-gray-300">
                    ₦{plan.setupFee.toLocaleString()}
                  </span>
                  <span className="text-xs text-gray-600">(one-time)</span>
                </div>

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm">
                      <span className="text-orange-500 font-bold shrink-0">✓</span>
                      <span className="text-gray-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/get-started?plan=${plan.id}`}
                  className={`block text-center font-black text-sm py-3.5 rounded-xl transition ${
                    plan.popular
                      ? "bg-orange-500 hover:bg-orange-600 text-white"
                      : "border border-white/20 hover:border-white/40 text-white"
                  }`}
                >
                  Choose {plan.name} →
                </Link>
              </div>
            ))}
          </div>

          {/* FAQ-style notes */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h3 className="font-black text-white mb-2">What is the setup fee?</h3>
              <p className="text-gray-400">
                A one-time fee to get your restaurant configured, your menu built, and your QR
                code generated.
              </p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h3 className="font-black text-white mb-2">Can I upgrade later?</h3>
              <p className="text-gray-400">
                Yes. You can switch plans at any time. You only pay the difference on the
                monthly subscription.
              </p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <h3 className="font-black text-white mb-2">Is there a free trial?</h3>
              <p className="text-gray-400">
                Yes. All plans include a 14-day free trial. You only pay the setup fee to
                activate your account.
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
