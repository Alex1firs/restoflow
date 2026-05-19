"use client";

import { useState, useEffect } from "react";

interface LoyaltyData {
  enabled: boolean;
  found: boolean;
  settings: { tickGoal: number; reward: string };
  profile: {
    currentTicks: number;
    totalTicks: number;
    rewardsEarned: number;
    unredeemedRewards: number;
  } | null;
}

interface Props {
  restaurantSlug: string;
  phone: string;
  restaurantName?: string;
  // Optional: pass pre-loaded data to skip the fetch (e.g. from payment callback)
  preloaded?: {
    tickGoal: number;
    reward: string;
    currentTicks: number;
    rewardUnlocked: boolean;
    unredeemedRewards: number;
  };
}

function StampRow({
  filled,
  total,
  animateFrom,
}: {
  filled: number;
  total: number;
  animateFrom?: number;
}) {
  const [displayed, setDisplayed] = useState(animateFrom ?? filled);

  useEffect(() => {
    if (animateFrom === undefined || animateFrom === filled) return;
    const timeout = setTimeout(() => setDisplayed(filled), 400);
    return () => clearTimeout(timeout);
  }, [filled, animateFrom]);

  const cols = total <= 5 ? total : 5;

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: total }, (_, i) => {
        const isFilled = i < displayed;
        const isNew = animateFrom !== undefined && i >= animateFrom && i < filled;
        return (
          <div
            key={i}
            className={`aspect-square rounded-xl flex items-center justify-center text-lg transition-all duration-500 ${
              isFilled
                ? isNew
                  ? "bg-white text-orange-600 scale-110 shadow-lg"
                  : "bg-white text-orange-600"
                : "bg-white/20 text-white/30"
            }`}
            style={{ transitionDelay: isNew ? `${i * 60}ms` : "0ms" }}
          >
            {isFilled ? "★" : "☆"}
          </div>
        );
      })}
    </div>
  );
}

export default function LoyaltyCard({ restaurantSlug, phone, restaurantName, preloaded }: Props) {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [loading, setLoading] = useState(!preloaded);

  useEffect(() => {
    if (preloaded) {
      setData({
        enabled: true,
        found: true,
        settings: { tickGoal: preloaded.tickGoal, reward: preloaded.reward },
        profile: {
          currentTicks: preloaded.currentTicks,
          totalTicks: preloaded.currentTicks,
          rewardsEarned: preloaded.unredeemedRewards,
          unredeemedRewards: preloaded.unredeemedRewards,
        },
      });
      return;
    }

    if (!phone) return;

    const params = new URLSearchParams({ slug: restaurantSlug, phone });
    fetch(`/api/customer/loyalty?${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [restaurantSlug, phone, preloaded]);

  if (loading) {
    return (
      <div className="h-40 bg-white/10 rounded-3xl animate-pulse" />
    );
  }

  if (!data?.enabled || !data.found || !data.profile) return null;

  const { currentTicks, unredeemedRewards } = data.profile;
  const { tickGoal, reward } = data.settings;
  const remaining = Math.max(0, tickGoal - currentTicks);
  const hasReward = unredeemedRewards > 0;

  return (
    <div className="relative">
      {/* Reward unlocked celebration overlay */}
      {(hasReward || preloaded?.rewardUnlocked) && (
        <div className="absolute -top-3 -right-3 z-10">
          <div className="bg-yellow-400 text-yellow-900 text-[11px] font-black px-3 py-1 rounded-full shadow-lg animate-bounce">
            🎁 Reward unlocked!
          </div>
        </div>
      )}

      <div className="bg-gradient-to-br from-orange-600 to-orange-700 rounded-3xl p-6 text-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Loyalty Card</p>
            <p className="text-base font-black leading-tight">{restaurantName || "Restaurant"}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Progress</p>
            <p className="text-sm font-black">{currentTicks}/{tickGoal}</p>
          </div>
        </div>

        {/* Stamps */}
        <StampRow
          filled={currentTicks}
          total={tickGoal}
          animateFrom={preloaded ? Math.max(0, currentTicks - 1) : undefined}
        />

        {/* Reward info */}
        <div className="mt-5 border-t border-white/20 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Reward</p>
              <p className="text-sm font-black">{reward}</p>
            </div>
            {hasReward ? (
              <div className="bg-yellow-400 text-yellow-900 text-xs font-black px-3 py-1.5 rounded-xl">
                Claim at counter
              </div>
            ) : (
              <div className="text-right">
                <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Until reward</p>
                <p className="text-sm font-black">
                  {remaining === 0 ? "Almost there!" : `${remaining} more order${remaining !== 1 ? "s" : ""}`}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
