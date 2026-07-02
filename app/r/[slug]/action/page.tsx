import { getAdminDb } from "@/lib/firebase-admin";
import QuickActionClient from "./QuickActionClient";

export const dynamic = 'force-dynamic';

export default async function QuickActionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  
  const db = getAdminDb();
  const docSnap = await db.collection("restaurants").doc(slug).get();
  
  if (!docSnap.exists) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-800">Restaurant not found</h1>
        </div>
      </div>
    );
  }
  
  const data = docSnap.data()!;
  
  if (!data.whatsappCheckoutEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center p-6 bg-white border rounded-2xl shadow-sm max-w-sm w-full">
          <h1 className="text-lg font-bold text-gray-800 mb-2">Feature Disabled</h1>
          <p className="text-gray-500 text-sm">WhatsApp Quick Action is not enabled for this restaurant.</p>
        </div>
      </div>
    );
  }
  
  return <QuickActionClient slug={slug} name={data.name as string || slug} />;
}
