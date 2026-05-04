import type { Metadata } from "next";
import { Suspense } from "react";
import { getAdminDb } from "@/lib/firebase-admin";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  type DocumentData,
} from "firebase/firestore";
import RestaurantClient from "@/app/r/[slug]/components/RestaurantClient";
import { CartProvider } from "@/app/r/[slug]/components/CartContext";
import Link from "next/link";
import {
  checkIsOpen,
  todayHours,
  type OpeningHours,
} from "@/lib/restaurant-utils";
import { buildPageTitle, buildPageDescription, buildJsonLd, type RestaurantSEOData } from "@/lib/seo-utils";

export const revalidate = 0;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}): Promise<Metadata> {
  const { domain } = await searchParams;
  if (!domain) return { title: "Restaurant" };
  try {
    const snap = await getAdminDb().collection("restaurants").where("customDomain", "==", domain).limit(1).get();
    if (snap.empty) return { title: "Restaurant" };
    const d = snap.docs[0].data();
    const slug = snap.docs[0].id;
    const seo: RestaurantSEOData = {
      slug,
      name: (d.name as string) ?? "",
      description: (d.description as string) ?? "",
      seoTitle: (d.seoTitle as string) ?? "",
      seoDescription: (d.seoDescription as string) ?? "",
      serviceAreas: (d.serviceAreas as string) ?? "",
      foodKeywords: (d.foodKeywords as string) ?? "",
      address: (d.address as string) ?? "",
      phone: (d.phone as string) ?? "",
      logo: (d.logo as string) ?? "",
      coverImage: (d.coverImage as string) ?? "",
      customDomain: domain,
      openingHours: (d.openingHours as OpeningHours) ?? null,
    };
    const title = buildPageTitle(seo);
    const description = buildPageDescription(seo);
    const canonical = `https://${domain}`;
    return {
      title,
      description,
      openGraph: { title, description, url: canonical, type: "website", ...(seo.coverImage && { images: [{ url: seo.coverImage, alt: seo.name }] }) },
      twitter: { card: "summary_large_image", title, description },
      alternates: { canonical },
      robots: { index: true, follow: true },
    };
  } catch { return { title: "Restaurant" }; }
}

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

export default async function RDomainPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; path?: string }>;
}) {
  const { domain } = await searchParams;

  if (!domain) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8 bg-white rounded-2xl shadow-sm border">
          <h1 className="text-2xl font-bold text-gray-800">Domain not configured</h1>
          <p className="text-gray-500 mt-2">
            No restaurant is linked to this domain.
          </p>
          <Link href="/" className="mt-6 inline-block text-orange-600 font-bold hover:underline">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  // Query Firestore (Admin SDK) for the restaurant with this custom domain
  const adminDb = getAdminDb();
  const snap = await adminDb
    .collection("restaurants")
    .where("customDomain", "==", domain)
    .limit(1)
    .get();

  if (snap.empty) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8 bg-white rounded-2xl shadow-sm border">
          <h1 className="text-2xl font-bold text-gray-800">Domain not configured</h1>
          <p className="text-gray-500 mt-2">
            No restaurant is linked to <strong>{domain}</strong>.
          </p>
          <p className="text-gray-400 text-sm mt-1">
            If you are the restaurant owner, please check your domain settings.
          </p>
          <Link href="/" className="mt-6 inline-block text-orange-600 font-bold hover:underline">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  const restaurantDoc = snap.docs[0];
  const slug = restaurantDoc.id;
  const restaurant = restaurantDoc.data() as RestaurantData;

  // Block if subscription expired
  if (isExpired(restaurant)) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-8 h-8 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-3">
            {restaurant.name}
          </h1>
          <p className="text-gray-500 font-medium mb-2">
            Online ordering is temporarily unavailable.
          </p>
          <p className="text-gray-400 text-sm">
            Please contact the restaurant directly to place your order.
          </p>
        </div>
      </div>
    );
  }

  // Fetch menu items from client SDK
  const menuQuery = query(
    collection(db, "menu_items"),
    where("restaurantId", "==", slug)
  );
  const menuSnap = await getDocs(menuQuery);
  const menuItems = menuSnap.docs.map((doc) => ({
    ...doc.data(),
    id: doc.id,
  })) as MenuItemData[];

  const rData = restaurant as {
    paystackSubaccountCode?: string;
    deliveryFee?: number;
    minimumOrder?: number;
    openingHours?: OpeningHours;
    logo?: string;
    address?: string;
    deliveryEnabled?: boolean;
    pickupEnabled?: boolean;
  };

  const todayH = todayHours(rData.openingHours);
  const todayHoursLabel = todayH
    ? todayH.open
      ? formatTodayHours(todayH.from, todayH.to)
      : "Closed today"
    : null;

  const seoData: RestaurantSEOData = {
    slug,
    name: restaurant.name,
    description: restaurant.description,
    seoTitle: (restaurantDoc.data().seoTitle as string) ?? "",
    seoDescription: (restaurantDoc.data().seoDescription as string) ?? "",
    serviceAreas: (restaurantDoc.data().serviceAreas as string) ?? "",
    foodKeywords: (restaurantDoc.data().foodKeywords as string) ?? "",
    googleBusinessUrl: (restaurantDoc.data().googleBusinessUrl as string) ?? "",
    instagramUrl: (restaurantDoc.data().instagramUrl as string) ?? "",
    tiktokUrl: (restaurantDoc.data().tiktokUrl as string) ?? "",
    address: rData.address ?? "",
    phone: (restaurantDoc.data().phone as string) ?? "",
    logo: rData.logo ?? "",
    coverImage: restaurant.coverImage,
    customDomain: domain,
    openingHours: rData.openingHours ?? null,
  };
  const jsonLd = buildJsonLd(seoData);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    <CartProvider>
      <Suspense
        fallback={
          <div className="min-h-screen bg-white flex items-center justify-center text-orange-500">
            Loading…
          </div>
        }
      >
        <RestaurantClient
          restaurant={{
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
          }}
          menuItems={menuItems}
        />
      </Suspense>
    </CartProvider>
    </>
  );
}
