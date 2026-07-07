"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CategoriesResponse, CollectionsResponse, DishCardData, Facet, NearResponse, Origin, RestaurantCardData, RestaurantsResponse, SearchResponse } from "./types";
import { dishRequest, restaurantRequest, filterOpenNowDishes, filterOpenNowRestaurants } from "./lib";
import { DishCard, RestaurantCard, CategoryChip, DishSkeleton, EmptyState, ErrorState } from "./components";

type GeoStatus = "idle" | "locating" | "granted" | "denied" | "unsupported";

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
const PinIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="2.6" /></svg>
);

async function getJSON<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

export default function DiscoverClient() {
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [openNow, setOpenNow] = useState(false);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");

  const [facets, setFacets] = useState<Facet[]>([]);
  const [dishes, setDishes] = useState<DishCardData[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantCardData[]>([]);
  const [excludedNoLocation, setExcludedNoLocation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Debounce the search input.
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery), 300);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Categories load once.
  useEffect(() => {
    const ac = new AbortController();
    getJSON<CategoriesResponse>("/api/discovery/categories", ac.signal)
      .then((r) => setFacets(r.facets))
      .catch(() => {/* non-fatal: chips just won't show */});
    return () => ac.abort();
  }, []);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(false);
    try {
      const dishUrl = dishRequest({ query, tag, origin });
      const restUrl = restaurantRequest({ query, tag, origin });
      const [dishRes, restRes] = await Promise.all([
        getJSON<SearchResponse | CollectionsResponse>(dishUrl, ac.signal),
        getJSON<NearResponse | RestaurantsResponse>(restUrl, ac.signal),
      ]);
      setDishes(dishRes.items);
      setRestaurants(restRes.items);
      setExcludedNoLocation("excludedNoUsableLocation" in restRes ? restRes.excludedNoUsableLocation : 0);
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // superseded by a newer load
      setError(true);
    } finally {
      // Only the latest controller clears loading.
      if (abortRef.current === ac) setLoading(false);
    }
  }, [query, tag, origin]);

  useEffect(() => { load(); }, [load]);

  const locateMe = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGeoStatus("unsupported"); return; }
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoStatus("granted"); },
      () => { setGeoStatus("denied"); }, // graceful fallback: keep browsing without location
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  };
  const clearLocation = () => { setOrigin(null); setGeoStatus("idle"); };

  const shownDishes = filterOpenNowDishes(dishes, openNow);
  const shownRestaurants = filterOpenNowRestaurants(restaurants, openNow);
  const isEmpty = !loading && !error && shownDishes.length === 0 && shownRestaurants.length === 0;

  const heading = query.trim()
    ? `Results for “${query.trim()}”`
    : tag
    ? facets.find((f) => f.tag === tag)?.label ?? "Category"
    : origin ? "Trending near you" : "Trending dishes";

  return (
    <div className="min-h-screen bg-[#FAF9F5] dark:bg-[#0D0C0B] text-[#141412] dark:text-[#F5F3EF]">
      {/* Header + search (sticky) */}
      <header className="sticky top-0 z-20 bg-[#FAF9F5]/95 dark:bg-[#0D0C0B]/95 backdrop-blur border-b border-[#EFECE6] dark:border-[#1F1F1C]">
        <div className="max-w-6xl mx-auto px-4 pt-4 pb-3">
          <div className="flex items-baseline justify-between mb-3">
            <h1 className="text-xl font-black tracking-tight">Discover<span className="text-orange-500">.</span></h1>
            <p className="text-[11px] font-semibold text-[#A19B91]">Food across RestoFlow</p>
          </div>
          <label className="flex items-center gap-2.5 bg-white dark:bg-[#141412] border border-[#EFECE6] dark:border-[#1F1F1C] rounded-full px-4 py-3 shadow-sm focus-within:border-orange-400 transition-colors">
            <span className="text-[#A19B91]"><SearchIcon /></span>
            <input
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              inputMode="search"
              placeholder="Search jollof, grills, pasta…"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-[#B8B2A8] text-[#141412] dark:text-[#F5F3EF]"
              aria-label="Search food"
            />
            {rawQuery && (
              <button type="button" onClick={() => setRawQuery("")} className="text-[#A19B91] text-lg leading-none px-1" aria-label="Clear search">×</button>
            )}
          </label>
        </div>

        {/* Category chips */}
        {facets.length > 0 && (
          <div className="max-w-6xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setTag(null)}
              className={`shrink-0 whitespace-nowrap text-xs font-bold px-3.5 py-2 rounded-full border transition-all ${
                tag === null ? "bg-orange-500 text-white border-orange-500 shadow-sm" : "bg-white dark:bg-[#141412] text-[#7A7368] dark:text-[#A19B91] border-[#EFECE6] dark:border-[#1F1F1C] hover:border-orange-400"
              }`}
            >
              All
            </button>
            {facets.map((f) => (
              <CategoryChip key={f.tag} facet={f} active={tag === f.tag} onClick={() => setTag(tag === f.tag ? null : f.tag)} />
            ))}
          </div>
        )}

        {/* Filters: Open now + Near me */}
        <div className="max-w-6xl mx-auto px-4 pb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpenNow((v) => !v)}
            className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition-all ${
              openNow ? "bg-emerald-500 text-white border-emerald-500" : "bg-white dark:bg-[#141412] text-[#7A7368] dark:text-[#A19B91] border-[#EFECE6] dark:border-[#1F1F1C]"
            }`}
            aria-pressed={openNow}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${openNow ? "bg-white" : "bg-emerald-500"}`} /> Open now
          </button>

          {origin ? (
            <button type="button" onClick={clearLocation} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-orange-500 text-white border border-orange-500">
              <PinIcon /> Near me · on ×
            </button>
          ) : (
            <button
              type="button"
              onClick={locateMe}
              disabled={geoStatus === "locating"}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-white dark:bg-[#141412] text-[#7A7368] dark:text-[#A19B91] border border-[#EFECE6] dark:border-[#1F1F1C] hover:border-orange-400 disabled:opacity-60"
            >
              <PinIcon /> {geoStatus === "locating" ? "Locating…" : "Near me"}
            </button>
          )}
        </div>
        {(geoStatus === "denied" || geoStatus === "unsupported") && (
          <div className="max-w-6xl mx-auto px-4 pb-2 -mt-1">
            <p className="text-[11px] text-[#A19B91]">Location unavailable — showing trending food instead. You can still search and browse.</p>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5">
        {error ? (
          <ErrorState onRetry={load} />
        ) : (
          <>
            {/* Dishes (food-first) */}
            <section aria-label="Dishes">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-base font-black">{heading}</h2>
                {!loading && shownDishes.length > 0 && <span className="text-[11px] font-semibold text-[#A19B91]">{shownDishes.length} dishes</span>}
              </div>
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => <DishSkeleton key={i} />)}
                </div>
              ) : shownDishes.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {shownDishes.map((d) => <DishCard key={d.id} dish={d} />)}
                </div>
              ) : !isEmpty ? (
                <p className="text-sm text-[#A19B91] py-6">No dishes match{openNow ? " (open now)" : ""}. Try another category.</p>
              ) : null}
            </section>

            {/* Restaurants (secondary) */}
            {!loading && shownRestaurants.length > 0 && (
              <section aria-label="Restaurants" className="mt-8">
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-base font-black">{origin ? "Restaurants near you" : "Restaurants"}</h2>
                  {origin && excludedNoLocation > 0 && (
                    <span className="text-[11px] font-semibold text-[#A19B91]">{excludedNoLocation} without a set location</span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {shownRestaurants.map((r) => <RestaurantCard key={r.slug} restaurant={r} />)}
                </div>
              </section>
            )}

            {origin && !loading && shownRestaurants.length === 0 && excludedNoLocation > 0 && (
              <p className="text-sm text-[#A19B91] mt-6">
                {excludedNoLocation} nearby restaurant{excludedNoLocation === 1 ? "" : "s"} don&apos;t have a set map location yet, so they&apos;re not shown in “near me”. Browse trending instead.
              </p>
            )}

            {isEmpty && (
              <EmptyState
                title={query.trim() ? "Nothing found" : "Nothing to show yet"}
                hint={query.trim() ? "Try a different dish, cuisine, or clear filters." : "Check back soon — restaurants are being added."}
              />
            )}
          </>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 py-8 text-center">
        <p className="text-[11px] text-[#B8B2A8]">Powered by RestoFlow · tap any dish to order from the restaurant</p>
      </footer>
    </div>
  );
}
