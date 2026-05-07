import { Metadata } from "next";
import PublicNav from "../components/PublicNav";
import Footer from "../components/Footer";

export const metadata: Metadata = {
  title: "Privacy Policy | RestoFlow",
  description: "Learn how RestoFlow handles your data, payment processing, and protects your restaurant and customer information.",
  openGraph: {
    title: "Privacy Policy | RestoFlow",
    description: "Learn how RestoFlow handles your data, payment processing, and protects your restaurant and customer information.",
    url: "https://restoflow.com/privacy-policy",
    siteName: "RestoFlow",
    images: [
      {
        url: "https://restoflow.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "RestoFlow Privacy Policy",
      },
    ],
    locale: "en_US",
    type: "website",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="bg-[#050505] text-[#EDEDED] min-h-screen selection:bg-orange-500/30 selection:text-white">
      <div className="absolute inset-0 mesh-bg opacity-40 pointer-events-none" />
      
      <PublicNav />

      <main className="relative pt-32 lg:pt-40 pb-20 px-4">
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="mb-12">
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4">
              Privacy <span className="text-orange-500 italic">Policy</span>
            </h1>
            <p className="text-white/50 text-lg">
              Last Updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          <div className="prose prose-invert prose-orange max-w-none prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tight prose-p:text-white/70 prose-li:text-white/70">
            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">1. Information Collected</h2>
              <p className="mb-4">
                We collect information to provide better services to our users. The types of information we collect include:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong>Account Information:</strong> When you register for an account, we collect your name, email address, phone number, and restaurant details.</li>
                <li><strong>Customer Order Data:</strong> We collect data related to orders placed through the RestoFlow platform, including item details, timestamps, and customer contact information provided during checkout.</li>
                <li><strong>Usage Data:</strong> We automatically collect information about how you interact with our services, such as IP addresses, device types, and browsing behavior.</li>
              </ul>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">2. Payment Processing via Paystack</h2>
              <p className="mb-4">
                RestoFlow uses Paystack for payment processing. We do not store full credit card numbers or sensitive payment details on our servers. 
              </p>
              <p className="mb-4">
                When a customer makes a payment, the transaction is processed securely through Paystack&apos;s infrastructure. Your restaurant receives payments directly to your connected Paystack account, ensuring fast and secure transactions.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">3. Restaurant and Customer Data Handling</h2>
              <p className="mb-4">
                We act as a data processor for the customer data collected on behalf of restaurants using our platform. 
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong>Restaurants:</strong> You retain ownership of your customer data. We use this data only to provide and improve the RestoFlow service.</li>
                <li><strong>Customers:</strong> We process your order information to ensure successful delivery or pickup of your food, and to provide order updates.</li>
              </ul>
              <p className="mb-4">
                We implement industry-standard security measures to protect both restaurant and customer data against unauthorized access, alteration, disclosure, or destruction.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">4. Cookies and Session Usage</h2>
              <p className="mb-4">
                RestoFlow uses cookies and similar tracking technologies to track activity on our platform and hold certain information. 
              </p>
              <p className="mb-4">
                We use cookies primarily for session management (keeping you logged in), remembering your preferences, and analyzing platform traffic to improve our user experience. You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent. However, if you do not accept cookies, some parts of our service may not function properly.
              </p>
            </section>

            <section className="mb-10">
              <h2 className="text-2xl text-white mb-4">5. Contact Us</h2>
              <p className="mb-4">
                If you have any questions about this Privacy Policy, please contact us at:
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
