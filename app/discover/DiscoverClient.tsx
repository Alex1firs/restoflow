"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CategoriesResponse, CollectionsResponse, DishCardData, Facet, RestaurantCardData, RestaurantsResponse, SearchResponse } from "./types";
import { dishRequest, restaurantRequest, filterOpenNowDishes, filterOpenNowRestaurants, partitionByArea, normalizeStateParam } from "./lib";
import { DishCard, RestaurantCard, CategoryChip, DishSkeleton, EmptyState, ErrorState } from "./components";
import { NIGERIA_STATES } from "@/lib/nigeria-states";

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
const PinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="2.6" /></svg>
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

  // Location (G3): manual state selection only. Browser geolocation deferred to G2.
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [browseAll, setBrowseAll] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(false);

  const [facets, setFacets] = useState<Facet[]>([]);
  const [dishes, setDishes] = useState<DishCardData[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Debounce the search input.
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery), 300);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Hydrate the selected state from the URL (?state=) after mount — shareable/reloadable.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("state");
    const norm = normalizeStateParam(raw, NIGERIA_STATES);
    if (norm) setSelectedState(norm);
  }, []);

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
      // origin=null: distance/near is a G2 concern; location here is state-based (client-side).
      const dishUrl = dishRequest({ query, tag, origin: null });
      const restUrl = restaurantRequest({ query, tag, origin: null });
      const [dishRes, restRes] = await Promise.all([
        getJSON<SearchResponse | CollectionsResponse>(dishUrl, ac.signal),
        getJSON<RestaurantsResponse>(restUrl, ac.signal),
      ]);
      setDishes(dishRes.items);
      setRestaurants(restRes.items);
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // superseded by a newer load
      setError(true);
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }, [query, tag]);

  useEffect(() => { load(); }, [load]);

  function chooseState(next: string | null) {
    setSelectedState(next);
    setBrowseAll(false);
    const sp = new URLSearchParams(window.location.search);
    if (next) sp.set("state", next);
    else sp.delete("state");
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }

  // Open-now first, then bucket by the customer's state (client-side, ranking untouched).
  const dishBuckets = partitionByArea(filterOpenNowDishes(dishes, openNow), selectedState, (d) => d.restaurant.state);
  const restBuckets = partitionByArea(filterOpenNowRestaurants(restaurants, openNow), selectedState, (r) => r.state);

  const primaryDishes = selectedState ? dishBuckets.inArea : [...dishBuckets.inArea, ...dishBuckets.unknown];
  const primaryRestaurants = selectedState ? restBuckets.inArea : [...restBuckets.inArea, ...restBuckets.unknown];
  const otherDishes = selectedState && browseAll ? [...dishBuckets.outOfArea, ...dishBuckets.unknown] : [];
  const otherRestaurants = selectedState && browseAll ? [...restBuckets.outOfArea, ...restBuckets.unknown] : [];
  const outDishIds = new Set(dishBuckets.outOfArea.map((d) => d.id));
  const outRestSlugs = new Set(restBuckets.outOfArea.map((r) => r.slug));

  const hiddenCount = selectedState && !browseAll
    ? dishBuckets.outOfArea.length + dishBuckets.unknown.length + restBuckets.outOfArea.length + restBuckets.unknown.length
    : 0;

  const primaryCount = primaryDishes.length + primaryRestaurants.length;
  const otherCount = otherDishes.length + otherRestaurants.length;
  const isEmpty = !loading && !error && primaryCount === 0 && otherCount === 0;

  const heading = query.trim()
    ? `Results for “${query.trim()}”`
    : tag
    ? facets.find((f) => f.tag === tag)?.label ?? "Category"
    : selectedState ? `Trending in ${selectedState}` : "Trending dishes";

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

        {/* Filters: Open now + State selector */}
        <div className="max-w-6xl mx-auto px-4 pb-3 flex items-center gap-2 flex-wrap">
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

          <div className={`inline-flex items-center gap-1.5 text-xs font-bold pl-3 pr-1.5 py-1.5 rounded-full border transition-all ${
            selectedState ? "bg-orange-500 text-white border-orange-500" : "bg-white dark:bg-[#141412] text-[#7A7368] dark:text-[#A19B91] border-[#EFECE6] dark:border-[#1F1F1C]"
          }`}>
            <PinIcon />
            <select
              value={selectedState ?? ""}
              onChange={(e) => chooseState(e.target.value || null)}
              aria-label="Choose your state"
              className={`bg-transparent outline-none font-bold text-xs pr-1 cursor-pointer ${selectedState ? "text-white [&>option]:text-[#141412]" : "text-[#7A7368] dark:text-[#A19B91] [&>option]:text-[#141412]"}`}
            >
              <option value="">All of Nigeria</option>
              {NIGERIA_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Passive prompt when no state chosen (D5) */}
        {!selectedState && !promptDismissed && (
          <div className="max-w-6xl mx-auto px-4 pb-2 -mt-1 flex items-center justify-between gap-3">
            <p className="text-[11px] text-[#A19B91]">Select your state to see food you can actually order.</p>
            <button type="button" onClick={() => setPromptDismissed(true)} className="text-[#B8B2A8] text-sm leading-none px-1 shrink-0" aria-label="Dismiss">×</button>
          </div>
        )}

        {/* Context + Browse-all reveal when a state is chosen (D3) */}
        {selectedState && (
          <div className="max-w-6xl mx-auto px-4 pb-2 -mt-1 flex items-center justify-between gap-3">
            <p className="text-[11px] text-[#A19B91]">
              Showing <span className="font-bold text-[#7A7368] dark:text-[#A19B91]">{selectedState}</span>
              {hiddenCount > 0 && !browseAll && ` · ${hiddenCount} elsewhere`}
            </p>
            {(hiddenCount > 0 || browseAll) && (
              <button type="button" onClick={() => setBrowseAll((v) => !v)} className="text-[11px] font-bold text-orange-500 hover:text-orange-600 shrink-0">
                {browseAll ? `Show only ${selectedState}` : "Browse all of Nigeria"}
              </button>
            )}
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
                {!loading && primaryDishes.length > 0 && <span className="text-[11px] font-semibold text-[#A19B91]">{primaryDishes.length} dishes</span>}
              </div>
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => <DishSkeleton key={i} />)}
                </div>
              ) : primaryDishes.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {primaryDishes.map((d) => <DishCard key={d.id} dish={d} />)}
                </div>
              ) : !isEmpty ? (
                <p className="text-sm text-[#A19B91] py-6">
                  {selectedState ? `No dishes in ${selectedState}${openNow ? " (open now)" : ""} yet.` : `No dishes match${openNow ? " (open now)" : ""}. Try another category.`}
                </p>
              ) : null}
            </section>

            {/* Restaurants (secondary) */}
            {!loading && primaryRestaurants.length > 0 && (
              <section aria-label="Restaurants" className="mt-8">
                <h2 className="text-base font-black mb-3">{selectedState ? `Restaurants in ${selectedState}` : "Restaurants"}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {primaryRestaurants.map((r) => <RestaurantCard key={r.slug} restaurant={r} />)}
                </div>
              </section>
            )}

            {/* Out-of-area (revealed via Browse all) — demoted + clearly labeled (D3/D4) */}
            {!loading && (otherDishes.length > 0 || otherRestaurants.length > 0) && (
              <section aria-label="Elsewhere in Nigeria" className="mt-10 pt-6 border-t border-[#EFECE6] dark:border-[#1F1F1C]">
                <h2 className="text-base font-black mb-1">Elsewhere in Nigeria</h2>
                <p className="text-[11px] text-[#A19B91] mb-3">Outside {selectedState} — check delivery is available to you before ordering.</p>
                {otherDishes.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {otherDishes.map((d) => <DishCard key={d.id} dish={d} outOfArea={outDishIds.has(d.id)} />)}
                  </div>
                )}
                {otherRestaurants.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                    {otherRestaurants.map((r) => <RestaurantCard key={r.slug} restaurant={r} outOfArea={outRestSlugs.has(r.slug)} />)}
                  </div>
                )}
              </section>
            )}

            {isEmpty && (
              <EmptyState
                title={selectedState ? `Nothing in ${selectedState} yet` : query.trim() ? "Nothing found" : "Nothing to show yet"}
                hint={
                  selectedState
                    ? hiddenCount > 0
                      ? "No restaurants here yet — tap “Browse all of Nigeria” above to see other states."
                      : "No restaurants in this state yet. Try another state or browse all of Nigeria."
                    : query.trim()
                    ? "Try a different dish, cuisine, or clear filters."
                    : "Check back soon — restaurants are being added."
                }
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
