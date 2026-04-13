import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import AdminOrdersClient from "./AdminOrdersClient";
import AdminNav from "../components/AdminNav";
import { notFound } from "next/navigation";

export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function AdminOrdersPage({ params }: Props) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug;

  const restaurantRef = doc(db, "restaurants", slug);
  const restaurantSnap = await getDoc(restaurantRef);

  if (!restaurantSnap.exists()) {
    return notFound();
  }

  const restaurant = {
    id: restaurantSnap.id,
    name: restaurantSnap.data().name,
    slug: restaurantSnap.data().slug,
  };

  return (
    <div className="bg-gray-100 min-h-screen">
      <AdminNav slug={slug} />
      <AdminOrdersClient restaurant={restaurant} />
    </div>
  );
}
