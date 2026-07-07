// Public customer discovery page — search & browse food across RestoFlow
// restaurants, then click into the existing /r/[slug] storefront to order.
// Server component shell (metadata) around the interactive client experience.
// Reads only the public /api/discovery/* endpoints; no auth, no accounts.

import type { Metadata } from "next";
import DiscoverClient from "./DiscoverClient";

export const metadata: Metadata = {
  title: "Discover food near you · RestoFlow",
  description: "Search and browse dishes and restaurants across RestoFlow. Find jollof, grills, pasta and more, then order from the restaurant.",
};

// Always render fresh (open-now status is time-sensitive).
export const dynamic = "force-dynamic";

export default function DiscoverPage() {
  return <DiscoverClient />;
}
