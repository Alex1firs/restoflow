import type { MetadataRoute } from "next";
import { getAdminDb } from "@/lib/firebase-admin";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://restoflow-nine.vercel.app";

  const staticPages: MetadataRoute.Sitemap = [
    { url: appUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${appUrl}/pricing`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${appUrl}/get-started`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
  ];

  try {
    const snap = await getAdminDb()
      .collection("restaurants")
      .where("subscriptionStatus", "in", ["active", "trialing"])
      .get();

    const restaurantPages: MetadataRoute.Sitemap = snap.docs.map((doc) => {
      const d = doc.data();
      const customDomain = d.customDomain as string | undefined;
      const baseUrl = customDomain ? `https://${customDomain}` : `${appUrl}/r/${doc.id}`;
      return {
        url: baseUrl,
        lastModified: new Date(),
        changeFrequency: "daily" as const,
        priority: 0.9,
      };
    });

    return [...staticPages, ...restaurantPages];
  } catch {
    return staticPages;
  }
}
