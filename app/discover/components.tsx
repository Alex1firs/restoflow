// Presentational components for /discover. No data fetching — pure display.
// Warm off-white surfaces + RestoFlow orange accent, mobile-first.
"use client";

import { useState } from "react";
import Link from "next/link";
import type { DishCardData, Facet, RestaurantCardData } from "./types";
import { dishHref, restaurantHref, formatPrice, formatDistance, fulfillmentLabel, statusLabel, locationLabel, type LinkOpts } from "./lib";

const CARD = "bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-2xl";
const MUTED = "text-[#7A7368] dark:text-[#A19B91]";

function initial(name: string) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

const MiniPin = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="2.6" /></svg>
);

/** City/State label, or an "Other state" marker for out-of-area cards. */
function LocationLine({ state, city, outOfArea }: { state: string | null; city: string | null; outOfArea?: boolean }) {
  const label = locationLabel({ state, city });
  if (outOfArea) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
        <MiniPin /> {label ? `${label} · other state` : "Other state"}
      </span>
    );
  }
  if (!label) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${MUTED}`}>
      <MiniPin /> {label}
    </span>
  );
}

function StatusPill({ openNow }: { openNow: boolean }) {
  const s = statusLabel(openNow);
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
        s.open
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.open ? "bg-emerald-500" : "bg-amber-500"}`} />
      {s.text}
    </span>
  );
}

function Thumb({ src, name, className }: { src: string | null; name: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
  }
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-orange-100 to-stone-200 dark:from-[#2A2724] dark:to-[#1A1815] text-orange-500 font-black text-2xl ${className}`}>
      {initial(name)}
    </div>
  );
}

export function DishCard({ dish, outOfArea, loc }: { dish: DishCardData; outOfArea?: boolean; loc?: LinkOpts }) {
  const img = dish.image || dish.restaurant.coverImage || dish.restaurant.logo || null;
  const dist = formatDistance(dish.distanceKm, dish.approximate);
  return (
    <Link href={dishHref(dish, loc)} className={`group flex flex-col overflow-hidden ${CARD} shadow-sm hover:shadow-md transition-shadow`}>
      <div className="relative aspect-[4/3] overflow-hidden">
        <Thumb src={img} name={dish.name} className="w-full h-full group-hover:scale-105 transition-transform duration-300" />
        {dish.promo?.active && dish.promo.label && (
          <span className="absolute top-2 left-2 bg-orange-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full shadow">
            {dish.promo.label}
          </span>
        )}
        <span className="absolute bottom-2 right-2 bg-white/95 dark:bg-black/70 text-[#141412] dark:text-white text-xs font-black px-2 py-0.5 rounded-full shadow">
          {formatPrice(dish.price, dish.priceHidden)}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <h3 className="font-bold text-sm leading-tight line-clamp-1 text-[#141412] dark:text-[#F5F3EF]">{dish.name}</h3>
        <div className="flex items-center gap-1.5 min-w-0">
          <Thumb src={dish.restaurant.logo || null} name={dish.restaurant.name} className="w-4 h-4 rounded-full shrink-0" />
          <span className={`text-xs truncate ${MUTED}`}>{dish.restaurant.name}</span>
        </div>
        <LocationLine state={dish.restaurant.state} city={dish.restaurant.city} outOfArea={outOfArea} />
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <StatusPill openNow={dish.restaurant.openNow} />
          {dist && <span className={`text-[10px] font-semibold ${MUTED}`}>{dist}</span>}
        </div>
        <p className={`text-[10px] ${MUTED} line-clamp-1`}>{fulfillmentLabel(dish.restaurant)}</p>
      </div>
    </Link>
  );
}

export function RestaurantCard({ restaurant, outOfArea, loc }: { restaurant: RestaurantCardData; outOfArea?: boolean; loc?: LinkOpts }) {
  const img = restaurant.coverImage || restaurant.logo || null;
  const dist = formatDistance(restaurant.distanceKm, restaurant.approximate);
  return (
    <Link href={restaurantHref(restaurant.slug, loc)} className={`flex items-center gap-3 p-3 ${CARD} shadow-sm hover:shadow-md transition-shadow`}>
      <Thumb src={img} name={restaurant.name} className="w-14 h-14 rounded-xl shrink-0" />
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <h3 className="font-bold text-sm leading-tight truncate text-[#141412] dark:text-[#F5F3EF]">{restaurant.name}</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill openNow={restaurant.openNow} />
          <LocationLine state={restaurant.state} city={restaurant.city} outOfArea={outOfArea} />
          {dist && <span className={`text-[10px] font-semibold ${MUTED}`}>{dist}</span>}
        </div>
        <p className={`text-[10px] ${MUTED} line-clamp-1`}>{fulfillmentLabel(restaurant)}</p>
      </div>
    </Link>
  );
}

export function CategoryChip({ facet, active, onClick }: { facet: Facet; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap text-xs font-bold px-3.5 py-2 rounded-full border transition-all ${
        active
          ? "bg-orange-500 text-white border-orange-500 shadow-sm"
          : "bg-white dark:bg-[#141412] text-[#7A7368] dark:text-[#A19B91] border-[#EFECE6] dark:border-[#1F1F1C] hover:border-orange-400"
      }`}
    >
      {facet.label}
      <span className={`ml-1.5 ${active ? "text-orange-100" : "text-[#B8B2A8]"}`}>{facet.count}</span>
    </button>
  );
}

export function DishSkeleton() {
  return (
    <div className={`overflow-hidden ${CARD} animate-pulse`}>
      <div className="aspect-[4/3] bg-stone-200 dark:bg-[#22201D]" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-stone-200 dark:bg-[#22201D] rounded w-3/4" />
        <div className="h-2.5 bg-stone-200 dark:bg-[#22201D] rounded w-1/2" />
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-14 h-14 rounded-2xl bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center text-2xl mb-3">🍽️</div>
      <h3 className="font-bold text-[#141412] dark:text-[#F5F3EF]">{title}</h3>
      <p className={`text-sm mt-1 max-w-xs ${MUTED}`}>{hint}</p>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center text-2xl mb-3">⚠️</div>
      <h3 className="font-bold text-[#141412] dark:text-[#F5F3EF]">Couldn&apos;t load discovery</h3>
      <p className={`text-sm mt-1 max-w-xs ${MUTED}`}>Something went wrong reaching the menu. Please try again.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-5 py-2.5 rounded-full transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
