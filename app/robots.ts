import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://restoflow.org";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/r/", "/pricing", "/get-started"],
        disallow: [
          "/admin/",
          "/super-admin/",
          "/api/",
          "/track/",
          "/r-domain",
          "/auth/",
        ],
      },
    ],
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
