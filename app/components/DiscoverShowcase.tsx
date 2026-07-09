"use client";

// Landing "For Food Lovers" section — a premium, consumer-facing awareness band
// directly below the hero. Read-only: fetches the existing public discovery API
// and deep-links each card to the exact dish on the restaurant storefront.
// No backend/ranking/checkout changes; merchant signup stays the hero's primary CTA.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, MapPin, Pause, Play } from "lucide-react";
import type { DishCardData, SearchResponse } from "@/app/discover/types";
import type { PublicCampaign } from "@/lib/campaigns/types";
import { formatPrice, locationLabel, dishHref } from "@/app/discover/lib";
import { resolveBannerHref } from "@/lib/campaigns/logic";
import { serviceAreaLine } from "./discover-showcase-lib";

function initial(name: string) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

// Promo banner card for an active campaign — a tile inside the discovery
// showcase (not a standalone full-width block). Renders only when the public
// projection carries a bannerImageUrl (Slice A gates this on active + enabled).
// The whole flyer is the clickable CTA — no overlay, so a self-contained promo
// design shows in full. The flyer is a 4:3 poster: shown whole (object-cover on
// a matching 4:3 slot = zero crop). Layout-neutral: fills its parent column and
// self-hides on load error so the surrounding section stays intact.
function CampaignBanner({ campaign }: { campaign: PublicCampaign }) {
  const [failed, setFailed] = useState(false);
  if (!campaign.bannerImageUrl || failed) return null;

  const href = resolveBannerHref(campaign.id, campaign.bannerCtaHref);
  const alt = campaign.bannerAlt || campaign.name;
  const desktop = campaign.bannerImageUrl;
  const mobile = campaign.bannerMobileImageUrl || desktop;

  return (
    <Link
      href={href}
      aria-label={alt}
      className="group relative block w-full overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/40 hover:border-orange-500/50 transition-colors duration-300"
    >
      <div className="relative w-full aspect-[4/3] bg-white/[0.03]">
        <picture>
          <source media="(max-width: 640px)" srcSet={mobile} />
          <img
            src={desktop}
            alt={alt}
            loading="lazy"
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.01]"
          />
        </picture>
      </div>
    </Link>
  );
}

function Thumb({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />;
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-500/20 to-white/5 text-orange-400 font-black text-3xl">
      {initial(name)}
    </div>
  );
}

function MealCard({ dish, campId }: { dish: DishCardData; campId?: string }) {
  const img = dish.image || dish.restaurant.coverImage || dish.restaurant.logo || null;
  const loc = locationLabel({ state: dish.restaurant.state, city: dish.restaurant.city });
  return (
    <Link
      href={dishHref(dish, campId ? { camp: campId } : undefined)}
      className="group snap-start shrink-0 w-[240px] sm:w-[260px] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] hover:border-orange-500/40 hover:bg-white/[0.05] transition-all duration-300"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <Thumb src={img} name={dish.name} />
        <span className="absolute bottom-2 right-2 bg-black/70 backdrop-blur text-white text-xs font-black px-2 py-0.5 rounded-full">
          {formatPrice(dish.price, dish.priceHidden)}
        </span>
      </div>
      <div className="flex flex-col gap-1 p-3.5">
        <h3 className="font-bold text-sm leading-tight line-clamp-1 text-white">{dish.name}</h3>
        <span className="text-xs text-white/50 line-clamp-1">{dish.restaurant.name}</span>
        {loc && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white/40">
            <MapPin size={11} className="shrink-0" /> {loc}
          </span>
        )}
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="snap-start shrink-0 w-[240px] sm:w-[260px] rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-white/5" />
      <div className="p-3.5 space-y-2">
        <div className="h-3 bg-white/5 rounded w-3/4" />
        <div className="h-2.5 bg-white/5 rounded w-1/2" />
      </div>
    </div>
  );
}

const AUTOPLAY_MS = 4000;

export default function DiscoverShowcase() {
  const [dishes, setDishes] = useState<DishCardData[]>([]);
  const [campaign, setCampaign] = useState<PublicCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef(false); // pause-on-hover without restarting the timer

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/discovery/search?limit=8", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: SearchResponse) => setDishes(Array.isArray(data.items) ? data.items : []))
      .catch(() => {/* graceful: heading + CTA still render, carousel hides */})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  // Active campaign for the landing entry point — promo note + ?camp carry. Non-fatal.
  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/campaigns/active?entry=landing", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { campaign: PublicCampaign | null }) => setCampaign(data.campaign))
      .catch(() => {/* no campaign */});
    return () => ac.abort();
  }, []);

  // Respect reduced-motion: no autoplay when the user asked for less motion.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  const campId = campaign?.id;
  const discoverHref = campId ? `/discover?camp=${encodeURIComponent(campId)}` : "/discover";

  const areaLine = serviceAreaLine(dishes.map((d) => d.restaurant.state));
  const hasCards = loading || dishes.length > 0;
  const hasBanner = Boolean(campaign?.bannerImageUrl);
  const canAutoplay = playing && !reduced && !loading && dishes.length > 1;

  const scrollBy = (dir: 1 | -1) => {
    scrollerRef.current?.scrollBy({ left: dir * 560, behavior: "smooth" });
  };
  // Prev/next is a manual interaction → stop autoplay (user can resume via play).
  const manualScroll = (dir: 1 | -1) => { setPlaying(false); scrollBy(dir); };
  const pauseAutoplay = () => setPlaying(false);

  // Smooth auto-advance by one card; loops back to the start at the end.
  // Hover skips ticks (via hoverRef) without tearing down the interval.
  useEffect(() => {
    if (!canAutoplay) return;
    const id = window.setInterval(() => {
      const el = scrollerRef.current;
      if (!el || hoverRef.current) return;
      const first = el.firstElementChild as HTMLElement | null;
      const step = first ? first.offsetWidth + 16 : Math.round(el.clientWidth * 0.8);
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 8) {
        el.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        el.scrollBy({ left: step, behavior: "smooth" });
      }
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [canAutoplay, dishes.length]);

  // Horizontal meal carousel — identical in both layouts; parent controls spacing.
  // Auto-slides smoothly (loops), pauses on hover and on manual interaction, and
  // supports native touch swipe. Autoplay is disabled under prefers-reduced-motion.
  const showAutoControl = !reduced && !loading && dishes.length > 1;
  const carousel = hasCards ? (
    <div
      className="relative"
      onMouseEnter={() => { hoverRef.current = true; }}
      onMouseLeave={() => { hoverRef.current = false; }}
    >
      {/* desktop arrows */}
      <button
        type="button" aria-label="Scroll left" onClick={() => manualScroll(-1)}
        className="hidden md:flex absolute -left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-white backdrop-blur transition"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button" aria-label="Scroll right" onClick={() => manualScroll(1)}
        className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-white backdrop-blur transition"
      >
        <ChevronRight size={18} />
      </button>

      <div
        ref={scrollerRef}
        onPointerDown={pauseAutoplay}
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [-webkit-overflow-scrolling:touch]"
      >
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          : dishes.map((d) => <MealCard key={d.id} dish={d} campId={campId} />)}
      </div>

      {/* subtle pause/play toggle (hidden under reduced-motion) */}
      {showAutoControl && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause auto-scroll" : "Play auto-scroll"}
            aria-pressed={!playing}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white px-3 py-1.5 text-[11px] font-bold transition"
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
            {playing ? "Pause" : "Play"}
          </button>
        </div>
      )}
    </div>
  ) : null;

  const ctaLink = (
    <Link
      href={discoverHref}
      className="group bg-orange-500 hover:bg-orange-400 text-white font-bold text-base px-8 py-4 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 glow-orange w-full sm:w-auto"
    >
      Explore restaurants
      <ArrowRight className="group-hover:translate-x-1 transition-transform" size={18} />
    </Link>
  );

  return (
    <section className="relative py-20 md:py-24 px-4 border-t border-white/5 overflow-hidden">
      {/* premium orange glow, distinct from the hero */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(249,115,22,0.10),transparent)]" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7 }}
        className="max-w-7xl mx-auto relative z-10"
      >
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-black uppercase tracking-widest text-orange-400">For Food Lovers</span>
          <h2 className="mt-3 text-3xl md:text-5xl font-black uppercase tracking-tighter text-white">
            Crave it? <span className="bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent italic">Find it near you.</span>
          </h2>
          <p className="mt-4 text-white/60 text-base md:text-lg leading-relaxed font-light">
            Discover real dishes from restaurants across Nigeria — browse by your state, see what&apos;s open now, and order in a tap. Free to browse, no account needed.
          </p>
          <Link href={discoverHref} className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-white/45 hover:text-orange-400 transition-colors">
            <MapPin size={13} /> {areaLine}
          </Link>

          {/* Lightweight promo note — only when a campaign is active but has no banner
              (with a banner, the promo tile below carries the message). */}
          {campaign && !hasBanner && (
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-4 py-2">
              <span>🎁</span>
              <p className="text-xs font-bold text-orange-300">
                {campaign.name} — order {campaign.threshold}× to qualify{campaign.prize ? ` for ${campaign.prize}` : ""}.
                <span className="font-normal text-white/50"> Terms apply.</span>
              </p>
            </div>
          )}
        </div>

        {hasBanner && campaign ? (
          // Integrated two-column composition: promo tile beside the meal carousel
          // on desktop; stacked (banner above carousel) on mobile.
          <div className="mt-12 grid gap-8 lg:gap-10 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-center">
            {/* Promo tile */}
            <div>
              <div className="mb-3 flex items-center justify-center lg:justify-start gap-2">
                <span aria-hidden className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                <span className="text-[11px] font-black uppercase tracking-widest text-orange-400">Live promo</span>
              </div>
              <CampaignBanner campaign={campaign} />
              <p className="mt-3 text-center lg:text-left text-xs text-white/50">
                {campaign.name} — order {campaign.threshold}× to qualify{campaign.prize ? ` for ${campaign.prize}` : ""}.
                <span className="text-white/35"> Terms apply.</span>
              </p>
            </div>

            {/* Meals to order now + CTA */}
            <div className="min-w-0">
              {carousel}
              <div className={`flex justify-center lg:justify-start ${carousel ? "mt-8" : ""}`}>{ctaLink}</div>
            </div>
          </div>
        ) : (
          // Clean discovery showcase (no active banner) — original single-column flow.
          <>
            {carousel && <div className="mt-12">{carousel}</div>}
            <div className="mt-12 flex justify-center">{ctaLink}</div>
          </>
        )}
      </motion.div>
    </section>
  );
}
