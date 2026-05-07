import { Metadata } from "next";
import PublicNav from "../components/PublicNav";
import Footer from "../components/Footer";

export const metadata: Metadata = {
  title: "Refund Policy | RestoFlow",
  description: "Read the RestoFlow Refund Policy. Learn about refund eligibility, processing timelines, and restaurant responsibilities.",
  openGraph: {
    title: "Refund Policy | RestoFlow",
    description: "Read the RestoFlow Refund Policy. Learn about refund eligibility, processing timelines, and restaurant responsibilities.",
    url: "https://restoflow.com/refund-policy",
    siteName: "RestoFlow",
    images: [
      {
        url: "https://restoflow.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "RestoFlow Refund Policy",
      },
    ],
    locale: "en_US",
    type: "website",
  },
};

export default function RefundPolicyPage() {
  return (
    <div className="bg-[#050505] text-[#EDEDED] min-h-screen selection:bg-orange-500/30 selection:text-white">
      <div className="absolute inset-0 mesh-bg opacity-40 pointer-events-none" />
      
      <PublicNav />

      <main className="relative pt-32 lg:pt-40 pb-20 px-4">
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="mb-12">
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4">
              Refund <span className="text-orange-500 italic">Policy</span>
            </h1>
            <p className="text-white/50 text-lg">
              Last Updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          <div className="prose prose-invert prose-orange max-w-none prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tight prose-p:text-white/70 prose-li:text-white/70">
            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">1. Refund Eligibility</h2>
              <p className="mb-4">
                At RestoFlow, we provide the platform for restaurants to receive and manage orders. Restaurants are solely responsible for the fulfillment and quality of all orders placed through the platform. However, customers can request refunds under the following circumstances:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong>Failed Payments:</strong> If a payment was deducted but the order failed to process on our system.</li>
                <li><strong>Duplicate Charges:</strong> If you were incorrectly charged multiple times for the same transaction.</li>
                <li><strong>Cancelled Orders:</strong> If an order is cancelled by the restaurant before fulfillment.</li>
                <li><strong>Undelivered Orders:</strong> If an order was accepted and paid for but never delivered or fulfilled by the restaurant.</li>
              </ul>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">2. Refund Processing</h2>
              <p className="mb-4">
                All refund requests are reviewed individually by our support team in collaboration with the respective restaurant.
              </p>
              <p className="mb-4">
                Once a refund is approved, it may take <strong>5–10 business days</strong> for the funds to reflect in your account, depending on your bank and payment provider&apos;s processing timelines.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">3. Subscription Fees</h2>
              <p className="mb-4">
                For our restaurant partners, RestoFlow operates on a SaaS subscription model. 
              </p>
              <p className="mb-4">
                SaaS subscription and setup fees are generally <strong>non-refundable</strong> once the onboarding and setup process has commenced, except where legally required.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">4. Restaurant Responsibility</h2>
              <p className="mb-4">
                Restaurants using the RestoFlow platform are entirely responsible for:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Ensuring accurate menu pricing and descriptions.</li>
                <li>Maintaining up-to-date item availability.</li>
                <li>Meeting estimated delivery timelines and resolving direct food quality disputes with customers.</li>
              </ul>
              <p className="mb-4">
                Disputes strictly regarding food quality, taste, or presentation must be resolved directly with the restaurant management.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">5. Contact Us</h2>
              <p className="mb-4">
                If you have an issue with an order or need to request a refund, please contact us at:
              </p>
              <div className="bg-white/5 border border-white/10 p-6 rounded-xl mt-4">
                <a href="mailto:hello@braintuneltd.com.ng" className="text-orange-500 font-bold hover:text-orange-400 transition-colors">
                  hello@braintuneltd.com.ng
                </a>
              </div>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
