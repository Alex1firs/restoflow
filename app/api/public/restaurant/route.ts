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

function isMainHost(host: string): boolean {
  const bare = host.replace(/^www\./, "").split(":")[0].toLowerCase();
  return (
    MAIN_HOSTS.includes(bare) ||
    MAIN_HOSTS.includes(host) ||
    bare.endsWith(".vercel.app")
  );
}

export const revalidate = 3600; // Cache for 1 hour

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain");
  const slug = searchParams.get("slug");

  const db = getAdminDb();

  try {
    // 1. Look up by custom domain
    if (domain) {
      const bareDomain = domain.replace(/^www\./, "").split(":")[0].toLowerCase();
      if (!isMainHost(bareDomain)) {
        const snap = await db
          .collection("restaurants")
          .where("customDomain", "==", bareDomain)
          .limit(1)
          .get();

        if (!snap.empty) {
          const d = snap.docs[0].data();
          return NextResponse.json({
            name: (d.name as string) ?? null,
            logo: (d.logo as string) ?? null,
          });
        }
      }
    }

    // 2. Look up by slug
    if (slug) {
      const snap = await db.collection("restaurants").doc(slug).get();
      if (snap.exists) {
        const d = snap.data()!;
        return NextResponse.json({
          name: (d.name as string) ?? null,
          logo: (d.logo as string) ?? null,
        });
      }
    }

    return NextResponse.json({ name: null, logo: null });
  } catch (err) {
    console.error("Public restaurant API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
