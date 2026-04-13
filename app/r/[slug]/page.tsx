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

  // 2. Fetch Menu Items Data
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
            slug: slug
          }} 
          menuItems={menuItems} 
          initialView={initialView as "home" | "menu" | "cart" | "checkout" | "success"}
        />
      </Suspense>
    </CartProvider>
  );
}
