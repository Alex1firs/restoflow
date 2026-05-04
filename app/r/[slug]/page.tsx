import type { Metadata } from "next";
import { Suspense } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, DocumentData } from 'firebase/firestore';
import { getAdminDb } from "@/lib/firebase-admin";
import RestaurantClient from './components/RestaurantClient';
import { CartProvider } from './components/CartContext';
import Link from 'next/link';
import { checkIsOpen, todayHours, type OpeningHours } from '@/lib/restaurant-utils';
import { buildPageTitle, buildPageDescription, buildJsonLd, buildCanonicalUrl, type RestaurantSEOData } from '@/lib/seo-utils';

function formatTodayHours(from: string, to: string): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

interface RestaurantData extends DocumentData {
  name: string;
  description: string;
  coverImage: string;
  subscriptionStatus?: string;
  subscriptionEndDate?: { toDate?: () => Date; seconds?: number };
  status?: string;
}

function isExpired(restaurant: RestaurantData): boolean {
  if (restaurant.subscriptionStatus === "expired") return true;
  if (restaurant.subscriptionEndDate) {
    const raw = restaurant.subscriptionEndDate;
    const end = raw.toDate ? raw.toDate() : new Date((raw.seconds ?? 0) * 1000);
    return end < new Date();
  }
  return false;
}

interface MenuItemData extends DocumentData {
  id: string;
  name: string;
  price: number;
  category: string;
  available: boolean;
  description: string;
  image?: string;
  restaurantId: string;
}

export const revalidate = 0;

async function fetchSEOData(slug: string): Promise<RestaurantSEOData | null> {
  try {
    const snap = await getAdminDb().collection("restaurants").doc(slug).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    return {
      slug,
      name: (d.name as string) ?? "",
      description: (d.description as string) ?? "",
      seoTitle: (d.seoTitle as string) ?? "",
      seoDescription: (d.seoDescription as string) ?? "",
      serviceAreas: (d.serviceAreas as string) ?? "",
      foodKeywords: (d.foodKeywords as string) ?? "",
      googleBusinessUrl: (d.googleBusinessUrl as string) ?? "",
      instagramUrl: (d.instagramUrl as string) ?? "",
      tiktokUrl: (d.tiktokUrl as string) ?? "",
      address: (d.address as string) ?? "",
      phone: (d.phone as string) ?? "",
      logo: (d.logo as string) ?? "",
      coverImage: (d.coverImage as string) ?? "",
      customDomain: (d.customDomain as string) ?? "",
      openingHours: (d.openingHours as OpeningHours) ?? null,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const seo = await fetchSEOData(slug);
  if (!seo) return { title: "Restaurant" };

  const title = buildPageTitle(seo);
  const description = buildPageDescription(seo);
  const canonical = buildCanonicalUrl(seo);
  const keywords = [
    seo.foodKeywords, seo.serviceAreas,
    "food delivery", "order food online", "restaurant",
  ].filter(Boolean).join(", ");

  return {
    title,
    description,
    keywords,
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      ...(seo.coverImage && { images: [{ url: seo.coverImage, alt: seo.name }] }),
    },
    twitter: { card: "summary_large_image", title, description },
    alternates: { canonical },
    robots: { index: true, follow: true },
  };
}

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ slug: string }>,
}) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug;

  const [seoData, docSnap] = await Promise.all([
    fetchSEOData(slug),
    getDoc(doc(db, 'restaurants', slug)),
  ]);

  if (!docSnap.exists()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8 bg-white rounded-2xl shadow-sm border">
          <h1 className="text-2xl font-bold text-gray-800">Restaurant not found</h1>
          <p className="text-gray-500 mt-2">The link you followed may be broken or the restaurant has moved.</p>
          <Link href="/" className="mt-6 inline-block text-orange-600 font-bold hover:underline">Return Home</Link>
        </div>
      </div>
    );
  }

  const restaurant = docSnap.data() as RestaurantData;

  if (isExpired(restaurant)) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-3">{restaurant.name}</h1>
          <p className="text-gray-500 font-medium mb-2">Online ordering is temporarily unavailable.</p>
          <p className="text-gray-400 text-sm">Please contact the restaurant directly to place your order.</p>
        </div>
      </div>
    );
  }

  // Drafts, pending review, rejected, or suspended are NOT visible to the public.
  // The owner can view them via the /admin/[slug]/preview route.
  if (restaurant.status !== "live") {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <div className="text-center p-8 bg-white rounded-2xl shadow-sm border max-w-md">
          <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-3">Not Available Yet</h1>
          <p className="text-gray-500 font-medium mb-4">
            This restaurant is currently setting up their profile and is not yet available for public orders.
          </p>
        </div>
      </div>
    );
  }

  const menuQuery = query(collection(db, 'menu_items'), where('restaurantId', '==', slug));
  const menuSnap = await getDocs(menuQuery);
  const menuItems = menuSnap.docs.map(d => ({ ...d.data(), id: d.id })) as MenuItemData[];

  const rData = restaurant as {
    paystackSubaccountCode?: string;
    deliveryFee?: number;
    minimumOrder?: number;
    openingHours?: OpeningHours;
    logo?: string;
    address?: string;
    deliveryEnabled?: boolean;
    pickupEnabled?: boolean;
    primaryColor?: string;
    accentColor?: string;
    promoBanner?: string;
    rating?: number;
    ordersToday?: number;
    deliveryTime?: string;
  };

  const todayH = todayHours(rData.openingHours);
  const todayHoursLabel = todayH
    ? todayH.open ? formatTodayHours(todayH.from, todayH.to) : "Closed today"
    : null;

  const jsonLd = seoData ? buildJsonLd(seoData) : null;

  const restaurantProps = {
    name: restaurant.name,
    description: restaurant.description,
    coverImage: restaurant.coverImage,
    logo: rData.logo ?? "",
    address: rData.address ?? "",
    slug,
    onlinePaymentEnabled: !!rData.paystackSubaccountCode,
    deliveryFee: rData.deliveryFee ?? 0,
    minimumOrder: rData.minimumOrder ?? 0,
    isOpen: checkIsOpen(rData.openingHours),
    deliveryEnabled: rData.deliveryEnabled !== false,
    pickupEnabled: rData.pickupEnabled !== false,
    todayHoursLabel,
    primaryColor: rData.primaryColor ?? "",
    accentColor: rData.accentColor ?? "",
    promoBanner: rData.promoBanner ?? "",
    rating: rData.rating ?? null,
    ordersToday: rData.ordersToday ?? null,
    deliveryTime: rData.deliveryTime ?? "",
  };

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <CartProvider>
        <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center text-orange-500">Loading…</div>}>
          <RestaurantClient
            restaurant={restaurantProps}
            menuItems={menuItems}
            seo={{
              seoTitle: seoData?.seoTitle,
              seoDescription: seoData?.seoDescription,
              serviceAreas: seoData?.serviceAreas,
              foodKeywords: seoData?.foodKeywords,
              googleBusinessUrl: seoData?.googleBusinessUrl,
              instagramUrl: seoData?.instagramUrl,
              tiktokUrl: seoData?.tiktokUrl,
            }}
          />
        </Suspense>
      </CartProvider>
    </>
  );
}
