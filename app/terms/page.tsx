import { Metadata } from "next";
import PublicNav from "../components/PublicNav";
import Footer from "../components/Footer";

export const metadata: Metadata = {
  title: "Terms of Service | RestoFlow",
  description: "Read the RestoFlow Terms of Service. Learn about restaurant responsibilities, subscription terms, acceptable use, and our policies.",
  openGraph: {
    title: "Terms of Service | RestoFlow",
    description: "Read the RestoFlow Terms of Service. Learn about restaurant responsibilities, subscription terms, acceptable use, and our policies.",
    url: "https://restoflow.com/terms",
    siteName: "RestoFlow",
    images: [
      {
        url: "https://restoflow.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "RestoFlow Terms of Service",
      },
    ],
    locale: "en_US",
    type: "website",
  },
};

export default function TermsOfServicePage() {
  return (
    <div className="bg-[#050505] text-[#EDEDED] min-h-screen selection:bg-orange-500/30 selection:text-white">
      <div className="absolute inset-0 mesh-bg opacity-40 pointer-events-none" />
      
      <PublicNav />

      <main className="relative pt-32 lg:pt-40 pb-20 px-4">
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="mb-12">
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4">
              Terms of <span className="text-orange-500 italic">Service</span>
            </h1>
            <p className="text-white/50 text-lg">
              Last Updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          <div className="prose prose-invert prose-orange max-w-none prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tight prose-p:text-white/70 prose-li:text-white/70">
            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">1. Acceptance of Terms</h2>
              <p className="mb-4">
                By accessing and using the RestoFlow platform, you accept and agree to be bound by the terms and provisions of this agreement.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">2. Restaurant Responsibilities</h2>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong>Menu Accuracy:</strong> You are responsible for ensuring that all menu items, prices, and descriptions are accurate and up-to-date.</li>
                <li><strong>Order Fulfillment:</strong> You agree to fulfill orders accepted through the platform in a timely and professional manner, maintaining the quality and safety standards expected by customers.</li>
                <li><strong>Customer Communication:</strong> You are responsible for managing customer expectations and handling disputes or refunds related to food quality or delivery delays.</li>
                <li><strong>Account Security:</strong> You are responsible for maintaining the confidentiality of your account login information and for all activities that occur under your account.</li>
              </ul>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">3. Subscription and Payment Terms</h2>
              <p className="mb-4">
                RestoFlow operates on a subscription model for restaurant partners.
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong>Billing:</strong> Subscription fees are billed in advance on a recurring basis (e.g., monthly). Payments are non-refundable, except as legally required.</li>
                <li><strong>Taxes:</strong> You are responsible for all applicable taxes associated with your use of the platform and any sales made through it.</li>
                <li><strong>Price Changes:</strong> We reserve the right to modify our pricing. We will provide at least 30 days notice prior to any changes taking effect.</li>
              </ul>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">4. Uptime Disclaimer</h2>
              <p className="mb-4">
                We strive to ensure that the RestoFlow platform is highly available and reliable. However, the service is provided &quot;as is&quot; and &quot;as available.&quot;
              </p>
              <p className="mb-4">
                We do not guarantee that the platform will be uninterrupted, error-free, or completely secure. We are not liable for any lost revenue, profits, or data resulting from service downtime, technical issues, or maintenance.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">5. Acceptable Use</h2>
              <p className="mb-4">
                You agree not to use the RestoFlow platform for any unlawful or prohibited purpose. You may not:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Violate any local, state, or national laws.</li>
                <li>Upload or transmit harmful code, viruses, or malicious software.</li>
                <li>Attempt to gain unauthorized access to our systems or other users&apos; accounts.</li>
                <li>Sell or distribute prohibited items through our platform.</li>
              </ul>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">6. Ownership of Restaurant Content</h2>
              <p className="mb-4">
                You retain all ownership rights to the content you upload to the platform, including your restaurant name, logos, menu item descriptions, and photos.
              </p>
              <p className="mb-4">
                By uploading this content, you grant RestoFlow a non-exclusive, worldwide, royalty-free license to use, display, and distribute this content solely for the purpose of operating and promoting the platform and your restaurant.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">7. Cancellation Terms</h2>
              <p className="mb-4">
                You may cancel your RestoFlow subscription at any time through your dashboard or by contacting our support team.
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong>Effective Date:</strong> Cancellations will take effect at the end of your current billing cycle. You will retain access to the platform until that time.</li>
                <li><strong>Data Export:</strong> Upon cancellation, you are responsible for exporting any necessary data. We may delete your account and associated data after the cancellation becomes effective.</li>
              </ul>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">8. Contact Us</h2>
              <p className="mb-4">
                If you have any questions about these Terms, please contact us at:
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
