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
    ? `Food Delivery in ${areas.slice(0, 3).join(", ")}`
    : restaurant.address || "Online Ordering";

  const aboutText = seo.seoDescription?.trim() ||
    `${restaurant.name} offers ${keywords.length > 0 ? keywords.join(", ") : "delicious meals"} with fast delivery${areas.length > 0 ? ` in ${areas.join(", ")}` : ""}. Order online and enjoy fresh food delivered to your door.`;

  const paymentMethods = [
    restaurant.onlinePaymentEnabled ? "Online payment (card/transfer)" : null,
    restaurant.deliveryEnabled ? "Cash on delivery" : null,
    restaurant.pickupEnabled ? "Cash on pickup" : null,
  ].filter(Boolean) as string[];

  const faqs = [
    {
      q: `How long does ${restaurant.name} take to deliver?`,
      a: "Most orders are prepared and dispatched within 20–40 minutes. Delivery time depends on your location. You can track your order in real time after placing it.",
    },
    {
      q: `What payment methods does ${restaurant.name} accept?`,
      a: paymentMethods.length > 0
        ? `${restaurant.name} accepts: ${paymentMethods.join(", ")}.`
        : `${restaurant.name} accepts cash on delivery and cash on pickup.`,
    },
    {
      q: `Where does ${restaurant.name} deliver?`,
      a: areas.length > 0
        ? `${restaurant.name} delivers to ${areas.join(", ")} and surrounding areas.`
        : `${restaurant.name} delivers to several locations. Enter your address at checkout to confirm coverage.`,
    },
    {
      q: `What kind of food does ${restaurant.name} serve?`,
      a: keywords.length > 0
        ? `${restaurant.name} serves ${keywords.join(", ")}.`
        : `${restaurant.name} serves a variety of freshly prepared meals. Browse the menu above to see all available items.`,
    },
    ...(restaurant.deliveryFee > 0
      ? [{
          q: `What is the delivery fee at ${restaurant.name}?`,
          a: `The delivery fee is ${fmt(restaurant.deliveryFee)}. This is added at checkout.`,
        }]
      : [{
          q: `Does ${restaurant.name} offer free delivery?`,
          a: `Yes — ${restaurant.name} currently offers free delivery on all orders.`,
        }]
    ),
  ];

  return (
    <div className="bg-white border-t border-gray-100 mt-8">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-14">

        {/* 1 — SEO Hero */}
        <section aria-label="About this restaurant">
          <p className="text-xs font-black text-orange-600 uppercase tracking-widest mb-2">{cityLine}</p>
          <h2 className="text-3xl font-black text-gray-900 leading-tight mb-4">
            {seo.seoTitle?.trim() || `Order from ${restaurant.name} Online`}
          </h2>
          <p className="text-gray-600 text-base leading-relaxed max-w-2xl">{aboutText}</p>
        </section>

        {/* 2 — About */}
        {(restaurant.description || keywords.length > 0) && (
          <section aria-label="Restaurant description">
            <h2 className="text-xl font-black text-gray-900 mb-3">About {restaurant.name}</h2>
            {restaurant.description && (
              <p className="text-gray-600 leading-relaxed mb-4">{restaurant.description}</p>
            )}
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {keywords.map((k) => (
                  <span key={k} className="bg-orange-50 text-orange-700 text-sm font-bold px-3 py-1.5 rounded-full border border-orange-100">
                    {k}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 3 — Service Areas */}
        {areas.length > 0 && (
          <section aria-label="Delivery areas">
            <h2 className="text-xl font-black text-gray-900 mb-3">Delivery Areas</h2>
            <p className="text-gray-500 text-sm mb-4">
              {restaurant.name} delivers to the following locations:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {areas.map((area) => (
                <div key={area} className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                  <svg className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                  </svg>
                  <span className="font-medium">{area}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 4 — Popular Items */}
        {popularItems.length > 0 && (
          <section aria-label="Popular menu items">
            <h2 className="text-xl font-black text-gray-900 mb-1">Popular Items</h2>
            <p className="text-gray-500 text-sm mb-5">Order directly from the menu above</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {popularItems.map((item) => (
                <div key={item.id} className="bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden">
                  {item.image && (
                    <img
                      src={item.image}
                      alt={`${item.name} from ${restaurant.name}`}
                      className="w-full h-32 object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="p-3">
                    <p className="font-black text-gray-900 text-sm">{item.name}</p>
                    {item.description && (
                      <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{item.description}</p>
                    )}
                    <p className="text-orange-600 font-black text-sm mt-1.5">{fmt(item.price)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 5 — FAQ */}
        <section aria-label="Frequently asked questions">
          <h2 className="text-xl font-black text-gray-900 mb-5">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {faqs.map((faq) => (
              <div key={faq.q} className="border border-gray-100 rounded-2xl px-5 py-4">
                <h3 className="font-black text-gray-900 text-sm">{faq.q}</h3>
                <p className="text-gray-500 text-sm mt-1.5 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer social links */}
        {(seo.googleBusinessUrl || seo.instagramUrl || seo.tiktokUrl) && (
          <section aria-label="Social links" className="border-t border-gray-100 pt-8">
            <p className="text-sm font-bold text-gray-400 mb-3">Find us online</p>
            <div className="flex flex-wrap gap-3">
              {seo.googleBusinessUrl && (
                <a href={seo.googleBusinessUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-bold text-gray-600 hover:text-orange-600 transition-colors px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 hover:border-orange-200">
                  Google Business
                </a>
              )}
              {seo.instagramUrl && (
                <a href={seo.instagramUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-bold text-gray-600 hover:text-orange-600 transition-colors px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 hover:border-orange-200">
                  Instagram
                </a>
              )}
              {seo.tiktokUrl && (
                <a href={seo.tiktokUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-bold text-gray-600 hover:text-orange-600 transition-colors px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 hover:border-orange-200">
                  TikTok
                </a>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
