import { Suspense } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, DocumentData } from 'firebase/firestore';
import RestaurantClient from './components/RestaurantClient';
import { CartProvider } from './components/CartContext';
import Link from 'next/link';

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

export const revalidate = 0;

export default async function RestaurantPage({ 
  params,
  searchParams
}: { 
  params: Promise<{ slug: string }>,
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const slug = resolvedParams.slug;
  const viewParam = resolvedSearchParams.view;
  const initialView = (Array.isArray(viewParam) ? viewParam[0] : viewParam) || 'home';

  // 1. Fetch Restaurant Data
  const docRef = doc(db, 'restaurants', slug);
  const docSnap = await getDoc(docRef);

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

  // 2. Block ordering if subscription has expired
  if (isExpired(restaurant)) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-white italic uppercase tracking-tighter mb-3">
            {restaurant.name}
          </h1>
          <p className="text-gray-400 font-medium mb-2">Online ordering is temporarily unavailable.</p>
          <p className="text-gray-600 text-sm">Please contact the restaurant directly to place your order.</p>
        </div>
      </div>
    );
  }

  // Fetch Menu Items
  const menuQuery = query(collection(db, 'menu_items'), where('restaurantId', '==', slug));
  const menuSnap = await getDocs(menuQuery);
  const menuItems = menuSnap.docs.map(doc => ({
    ...doc.data(),
    id: doc.id
  })) as MenuItemData[];

  return (
    <CartProvider>
      <Suspense fallback={<div className="min-h-screen bg-gray-900 flex items-center justify-center text-orange-500">Loading experience...</div>}>
        <RestaurantClient
          restaurant={{
            name: restaurant.name,
            description: restaurant.description,
            coverImage: restaurant.coverImage,
            slug: slug,
            onlinePaymentEnabled: !!(restaurant as { paystackSubaccountCode?: string }).paystackSubaccountCode,
          }}
          menuItems={menuItems}
          initialView={initialView as "home" | "menu" | "cart" | "checkout" | "success"}
        />
      </Suspense>
    </CartProvider>
  );
}
