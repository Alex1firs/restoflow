import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

const MAIN_HOSTS = [
  "restoflow.org",
  "www.restoflow.org",
  "restoflow-nine.vercel.app",
  "restaflow.com",
  "www.restaflow.com",
  "localhost",
];

// Helper to check if a hostname is our main domain
function isMainHost(host: string): boolean {
  const bare = host.replace(/^www\./, "").split(":")[0].toLowerCase();
  return (
    MAIN_HOSTS.includes(bare) ||
    MAIN_HOSTS.includes(host) ||
    bare.endsWith(".vercel.app")
  );
}

// Fallback default RestoFlow PWA Manifest
const DEFAULT_MANIFEST = {
  name: "Restoflow",
  short_name: "Restoflow",
  description: "Restaurant ordering, POS, kitchen, and dine-in operations platform.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#050505",
  theme_color: "#f97316",
  categories: ["business", "food"],
  icons: [
    {
      src: "/icons/icon-32.png",
      sizes: "32x32",
      type: "image/png"
    },
    {
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any"
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any"
    },
    {
      src: "/icons/maskable-icon.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable"
    }
  ],
  shortcuts: [
    {
      name: "Dashboard",
      url: "/admin/dashboard",
      description: "Open restaurant dashboard"
    },
    {
      name: "POS",
      url: "/admin/pos",
      description: "Open point of sale"
    }
  ]
};

export const revalidate = 0; // Dynamic on every request

export async function GET(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const referer = request.headers.get("referer") ?? "";
  const bareHost = host.replace(/^www\./, "").split(":")[0].toLowerCase();

  let restaurantName = "";
  let restaurantLogo = "";
  let startUrl = "/";
  let scope = "/";

  const db = getAdminDb();

  try {
    if (!isMainHost(bareHost)) {
      // 1. Custom Domain flow: Fetch restaurant details matching customDomain = bareHost
      const snap = await db
        .collection("restaurants")
        .where("customDomain", "==", bareHost)
        .limit(1)
        .get();

      if (!snap.empty) {
        const d = snap.docs[0].data();
        restaurantName = (d.name as string) ?? "";
        restaurantLogo = (d.logo as string) ?? "";
        startUrl = "/"; // Custom domains open directly at the root
        scope = "/";
      }
    } else if (referer) {
      // 2. Sub-path flow (e.g. restoflow.org/r/grills-capitol)
      // Check if referrer path is /r/[slug]
      const url = new URL(referer);
      const pathname = url.pathname;
      if (pathname.startsWith("/r/")) {
        const slug = pathname.split("/")[2];
        if (slug) {
          const snap = await db.collection("restaurants").doc(slug).get();
          if (snap.exists) {
            const d = snap.data()!;
            restaurantName = (d.name as string) ?? "";
            restaurantLogo = (d.logo as string) ?? "";
            startUrl = `/r/${slug}`;
            scope = `/r/${slug}/`; // Scope PWA only to this restaurant storefront
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to build dynamic PWA manifest:", err);
  }

  // If a specific restaurant is found, customize the manifest
  if (restaurantName) {
    const customIcons = restaurantLogo
      ? [
          {
            src: restaurantLogo,
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: restaurantLogo,
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          }
        ]
      : DEFAULT_MANIFEST.icons;

    const customManifest = {
      ...DEFAULT_MANIFEST,
      name: restaurantName,
      short_name: restaurantName,
      description: `Order online from ${restaurantName}.`,
      start_url: startUrl,
      scope: scope,
      icons: customIcons,
      shortcuts: [] // Remove admin shortcuts for customers
    };

    return NextResponse.json(customManifest, {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Type": "application/json"
      }
    });
  }

  // Otherwise, return default Restoflow manifest
  return NextResponse.json(DEFAULT_MANIFEST, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "application/json"
    }
  });
}
