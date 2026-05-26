import type { Metadata } from "next";
import { Suspense } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, DocumentData } from 'firebase/firestore';
import { getAdminDb, getAdminAuth } from "@/lib/firebase-admin";
import RestaurantClient from '@/app/r/[slug]/components/RestaurantClient';
import { CartProvider } from '@/app/r/[slug]/components/CartContext';
import Link from 'next/link';
import { checkIsOpen, todayHours, type OpeningHours } from '@/lib/restaurant-utils';
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const revalidate = 0;

interface RestaurantData extends DocumentData {
  name: string;
  description: string;
  coverImage: string;
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

async function verifyAccess(slug: string) {
  const cookieStore = await cookies();
  const session = cookieStore.get("__session")?.value;
  if (!session) redirect("/admin/login");
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    const userDoc = await getAdminDb().collection("users").doc(decoded.uid).get();
    if (!userDoc.exists) redirect("/admin/login");
    const data = userDoc.data()!;
    
    if (data.role === "super_admin") return true;
    if (data.restaurantSlug === slug) return true;
    
    redirect("/admin/login");
  } catch {
    redirect("/admin/login");
  }
}

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>,
}) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug;

  await verifyAccess(slug);

  const docSnap = await getDoc(doc(db, 'restaurants', slug));

  if (!docSnap.exists()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8 bg-white rounded-2xl shadow-sm border">
          <h1 className="text-2xl font-bold text-gray-800">Restaurant not found</h1>
          <p className="text-gray-500 mt-2">The link you followed may be broken or the restaurant has moved.</p>
        </div>
      </div>
    );
  }

  const restaurant = docSnap.data() as RestaurantData;

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
    dineInEnabled?: boolean;
    primaryColor?: string;
    accentColor?: string;
    promoBanner?: string;
    rating?: number;
    ordersToday?: number;
    deliveryTime?: string;
  };

  const todayH = todayHours(rData.openingHours);
  const todayHoursLabel = todayH
    ? todayH.open ? `${todayH.from} – ${todayH.to}` : "Closed today"
    : null;

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
    dineInEnabled: rData.dineInEnabled === true,
    todayHoursLabel,
    primaryColor: rData.primaryColor ?? "",
    accentColor: rData.accentColor ?? "",
    promoBanner: rData.promoBanner ?? "",
    rating: rData.rating ?? null,
    ordersToday: rData.ordersToday ?? null,
    deliveryTime: rData.deliveryTime ?? "",
  };

  return (
    <CartProvider>
      <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center text-orange-500">Loading…</div>}>
        <RestaurantClient
          restaurant={restaurantProps}
          menuItems={menuItems}
          seo={{}}
          isPreview={true}
        />
      </Suspense>
    </CartProvider>
  );
}
