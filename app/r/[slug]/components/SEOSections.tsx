interface MenuItemData {
  id: string;
  name: string;
  price: number;
  category: string;
  available: boolean;
  description: string;
  image?: string;
}

interface SEOSectionsProps {
  restaurant: {
    name: string;
    address?: string;
    description?: string;
    onlinePaymentEnabled: boolean;
    deliveryEnabled: boolean;
    pickupEnabled: boolean;
    deliveryFee: number;
  };
  seo: {
    seoTitle?: string;
    seoDescription?: string;
    serviceAreas?: string;
    foodKeywords?: string;
    googleBusinessUrl?: string;
    instagramUrl?: string;
    tiktokUrl?: string;
  };
  menuItems: MenuItemData[];
}

function fmt(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}

function parseList(s?: string): string[] {
  if (!s?.trim()) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export default function SEOSections({ restaurant, seo, menuItems }: SEOSectionsProps) {
  const areas = parseList(seo.serviceAreas);
  const keywords = parseList(seo.foodKeywords);
  const popularItems = menuItems.filter((i) => i.available).slice(0, 6);

  const cityLine = areas.length > 0
    ? `Premium Food Delivery in ${areas.slice(0, 3).join(", ")}`
    : restaurant.address || "Online Ordering";

  const aboutText = seo.seoDescription?.trim() ||
    `${restaurant.name} offers premium ${keywords.length > 0 ? keywords.join(", ") : "culinary creations"} with reliable, fast delivery${areas.length > 0 ? ` throughout ${areas.join(", ")}` : ""}. Experience fresh, chef-crafted meals ordered online and delivered straight to your door.`;

  const paymentMethods = [
    restaurant.onlinePaymentEnabled ? "Online Card or Bank Transfer" : null,
    restaurant.deliveryEnabled ? "Cash on Delivery" : null,
    restaurant.pickupEnabled ? "Pay on Pickup" : null,
  ].filter(Boolean) as string[];

  const faqs = [
    {
      q: `How long does ${restaurant.name} take to deliver?`,
      a: "Most orders are freshly prepared and dispatched within 20–40 minutes. Final delivery times may vary slightly based on your exact location and real-time traffic conditions. You will receive a live order status link to monitor preparation progress.",
    },
    {
      q: `What payment methods does ${restaurant.name} accept?`,
      a: paymentMethods.length > 0
        ? `${restaurant.name} offers secure checkout options including: ${paymentMethods.join(", ")}.`
        : `${restaurant.name} supports cash payments upon delivery or pickup.`,
    },
    {
      q: `Where does ${restaurant.name} deliver?`,
      a: areas.length > 0
        ? `${restaurant.name} provides fast delivery services directly to ${areas.join(", ")} and immediate surrounding neighborhoods.`
        : `${restaurant.name} services a wide radius. Simply enter your delivery address at checkout to instantly verify coverage and fees.`,
    },
    {
      q: `What kind of food does ${restaurant.name} serve?`,
      a: keywords.length > 0
        ? `${restaurant.name} specializes in high-quality, freshly prepared ${keywords.join(", ")}.`
        : `${restaurant.name} serves a diverse variety of chef-crafted meals. Browse our full digital menu above to see all live dishes, drinks, and desserts.`,
    },
    ...(restaurant.deliveryFee > 0
      ? [{
          q: `What is the delivery fee at ${restaurant.name}?`,
          a: `Our standard delivery service fee is ${fmt(restaurant.deliveryFee)}, which is calculated and appended transparently to your order subtotal at checkout.`,
        }]
      : [{
          q: `Does ${restaurant.name} offer free delivery?`,
          a: `Yes! ${restaurant.name} is currently offering complimentary delivery on all online orders placed directly through our storefront.`,
        }]
    ),
  ];

  return (
    <div className="bg-[#FAF9F5]/40 dark:bg-[#0D0C0B]/40 border-t border-[#EFECE6] dark:border-[#1F1F1C] transition-colors duration-300">
      <div className="max-w-6xl mx-auto px-6 py-16 space-y-16">

        {/* 1 — SEO Hero Intro */}
        <section aria-label="About this restaurant" className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--brand-primary-10)] border border-[var(--brand-primary-20)] text-[var(--brand-primary)] text-[10px] font-bold uppercase tracking-wider">
            <span>✨</span> {cityLine}
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-neutral-900 dark:text-neutral-50 tracking-tight leading-tight">
            {seo.seoTitle?.trim() || `Savor Premium Dining from ${restaurant.name} Online`}
          </h2>
          <p className="text-[#7A7368] dark:text-[#A19B91] text-base leading-relaxed max-w-3xl">
            {aboutText}
          </p>
        </section>

        {/* 2 — About & Food Specialties */}
        {(restaurant.description || keywords.length > 0) && (
          <section aria-label="Restaurant description" className="space-y-4">
            <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">Our Cuisine Philosophy</h2>
            {restaurant.description && (
              <p className="text-[#7A7368] dark:text-[#A19B91] leading-relaxed text-sm md:text-base">
                {restaurant.description}
              </p>
            )}
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {keywords.map((k) => (
                  <span
                    key={k}
                    className="bg-white dark:bg-[#141412] text-[#7A7368] dark:text-[#A19B91] text-xs font-bold px-3.5 py-2 rounded-xl border border-[#EFECE6] dark:border-[#1F1F1C] hover:border-[var(--brand-primary)] transition-all cursor-default"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 3 — Service Areas */}
        {areas.length > 0 && (
          <section aria-label="Delivery areas" className="space-y-4">
            <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">Reliable Service Neighborhoods</h2>
            <p className="text-[#7A7368] dark:text-[#A19B91] text-sm">
              We proudly offer fresh delivery and pickup services to the following regions:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {areas.map((area) => (
                <div
                  key={area}
                  className="flex items-center gap-2.5 text-sm text-neutral-800 dark:text-neutral-200 bg-white dark:bg-[#141412] rounded-2xl px-4 py-3.5 border border-[#EFECE6] dark:border-[#1F1F1C]"
                >
                  <svg className="w-4 h-4 text-[var(--brand-primary)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="font-semibold tracking-tight">{area}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 4 — Popular Showcase Grid */}
        {popularItems.length > 0 && (
          <section aria-label="Popular menu items" className="space-y-5">
            <div>
              <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">Highly Recommended by Guests</h2>
              <p className="text-[#7A7368] dark:text-[#A19B91] text-xs mt-1">Sourced directly from our menu for easy ordering above</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {popularItems.map((item) => (
                <div
                  key={item.id}
                  className="group bg-white dark:bg-[#141412] rounded-2xl border border-[#EFECE6] dark:border-[#1F1F1C] overflow-hidden flex flex-col hover:border-[var(--brand-primary)] dark:hover:border-[var(--brand-primary)] transition-all duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.01)]"
                >
                  {item.image && (
                    <div className="relative h-40 overflow-hidden bg-stone-100 dark:bg-stone-900 flex-shrink-0">
                      <img
                        src={item.image}
                        alt={`${item.name} from ${restaurant.name}`}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="p-4 flex flex-col flex-grow justify-between">
                    <div>
                      <p className="font-bold text-neutral-900 dark:text-neutral-50 text-sm tracking-tight">{item.name}</p>
                      {item.description && (
                        <p className="text-[#7A7368] dark:text-[#A19B91] text-xs mt-1 line-clamp-2 leading-relaxed">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <p className="text-[var(--brand-primary)] font-extrabold text-sm mt-3 tracking-tight">
                      {fmt(item.price)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 5 — Elegant FAQs */}
        <section aria-label="Frequently asked questions" className="space-y-6">
          <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">Storefront Operations FAQ</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {faqs.map((faq) => (
              <div
                key={faq.q}
                className="bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl p-5 hover:border-[var(--brand-primary)] transition-all duration-200"
              >
                <h3 className="font-bold text-neutral-900 dark:text-neutral-50 text-sm tracking-tight leading-snug">{faq.q}</h3>
                <p className="text-[#7A7368] dark:text-[#A19B91] text-xs md:text-sm mt-2 leading-relaxed font-medium">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
