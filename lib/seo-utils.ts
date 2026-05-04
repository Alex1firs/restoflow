import type { OpeningHours } from "./restaurant-utils";

const DAY_SCHEMA: Record<string, string> = {
  "1": "Mo", "2": "Tu", "3": "We", "4": "Th", "5": "Fr", "6": "Sa", "0": "Su",
};

export function openingHoursSchema(hours?: OpeningHours | null): string[] {
  if (!hours) return [];
  return Object.entries(hours)
    .filter(([, v]) => v.open)
    .map(([k, v]) => `${DAY_SCHEMA[k]} ${v.from}-${v.to}`);
}

export interface RestaurantSEOData {
  name: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  serviceAreas?: string;
  foodKeywords?: string;
  googleBusinessUrl?: string;
  instagramUrl?: string;
  tiktokUrl?: string;
  address?: string;
  phone?: string;
  logo?: string;
  coverImage?: string;
  slug: string;
  customDomain?: string;
  openingHours?: OpeningHours | null;
}

export function buildPageTitle(r: RestaurantSEOData): string {
  if (r.seoTitle?.trim()) return r.seoTitle.trim();
  const areas = r.serviceAreas?.trim();
  return areas
    ? `${r.name} — Food Delivery in ${areas.split(",")[0].trim()}`
    : `${r.name} — Order Food Online`;
}

export function buildPageDescription(r: RestaurantSEOData): string {
  if (r.seoDescription?.trim()) return r.seoDescription.trim();
  const base = r.description?.trim() || `Order from ${r.name} online.`;
  const areas = r.serviceAreas?.split(",")[0]?.trim();
  return areas ? `${base} Fast delivery in ${areas}.` : base;
}

export function buildCanonicalUrl(r: RestaurantSEOData): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (r.customDomain) return `https://${r.customDomain}`;
  return `${appUrl}/r/${r.slug}`;
}

export function buildJsonLd(r: RestaurantSEOData): object {
  const canonicalUrl = buildCanonicalUrl(r);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const keywords = r.foodKeywords?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const sameAs: string[] = [];
  if (r.googleBusinessUrl?.trim()) sameAs.push(r.googleBusinessUrl.trim());
  if (r.instagramUrl?.trim()) sameAs.push(r.instagramUrl.trim());
  if (r.tiktokUrl?.trim()) sameAs.push(r.tiktokUrl.trim());

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: r.name,
    url: canonicalUrl,
    hasMenu: `${appUrl}/r/${r.slug}`,
    ...(r.description && { description: r.description }),
    ...(r.logo && { logo: r.logo, image: r.coverImage || r.logo }),
    ...(r.phone && { telephone: r.phone }),
    ...(r.address && {
      address: {
        "@type": "PostalAddress",
        streetAddress: r.address,
        addressCountry: "NG",
      },
    }),
    ...(keywords.length > 0 && { servesCuisine: keywords }),
    ...(sameAs.length > 0 && { sameAs }),
  };

  const hoursSpec = openingHoursSchema(r.openingHours);
  if (hoursSpec.length > 0) ld.openingHours = hoursSpec;

  return ld;
}
