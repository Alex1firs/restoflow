"use client";

import { useState, useEffect, useCallback } from "react";
import type { LoyaltySettings } from "@/lib/loyalty";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoyaltyCustomer {
  phone: string;
  name: string;
  currentTicks: number;
  totalTicks: number;
  rewardsEarned: number;
  rewardsRedeemed: number;
  unredeemedRewards: number;
  lastEarnedAt: string | null;
}

interface Analytics {
  totalCustomers: number;
  nearReward: number;
  totalRewardsEarned: number;
  totalRewardsRedeemed: number;
  pendingRedemptions: number;
}

type Tab = "settings" | "customers" | "analytics";

// ─── Stamp card visual ────────────────────────────────────────────────────────

function StampCard({
  current,
  goal,
  reward,
  restaurantName,
}: {
  current: number;
  goal: number;
  reward: string;
  restaurantName: string;
}) {
  const stamps = Array.from({ length: goal }, (_, i) => i < current);
  const cols = goal <= 5 ? goal : goal <= 10 ? 5 : goal <= 15 ? 5 : 5;

  return (
    <div className="bg-gradient-to-br from-orange-600 to-orange-700 rounded-3xl p-6 text-white shadow-2xl select-none">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Loyalty Card</p>
          <p className="text-lg font-black leading-tight">{restaurantName}</p>
        </div>
        <div className="text-3xl">🍽️</div>
      </div>

      <div
        className="grid gap-2 mb-5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {stamps.map((filled, i) => (
          <div
            key={i}
            className={`aspect-square rounded-xl flex items-center justify-center text-base transition-all ${
              filled
                ? "bg-white text-orange-600 shadow-md"
                : "bg-white/20 text-white/30"
            }`}
          >
            {filled ? "★" : "☆"}
          </div>
        ))}
      </div>

      <div className="border-t border-white/20 pt-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Reward</p>
          <p className="text-sm font-black">{reward}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Progress</p>
          <p className="text-sm font-black">{current}/{goal} ticks</p>
        </div>
      </div>
    </div>
  );
}

// ─── Tick progress mini bar ───────────────────────────────────────────────────

function TickBar({ current, goal }: { current: number; goal: number }) {
  const pct = Math.min((current / goal) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-orange-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-black text-gray-500 w-12 text-right">
        {current}/{goal}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LoyaltyClient({
  slug,
  initialSettings,
  restaurantName,
  userRole,
}: {
  slug: string;
  initialSettings: LoyaltySettings;
  restaurantName: string;
  userRole: string;
}) {
  const canEdit = userRole === "owner" || userRole === "manager";
  const [tab, setTab] = useState<Tab>("settings");

  // ── Settings state ──────────────────────────────────────────────────────
  const [settings, setSettings] = useState<LoyaltySettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // ── Customers state ─────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<LoyaltyCustomer[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [search, setSearch] = useState("");

  // ── Redemption state ────────────────────────────────────────────────────
  const [redeemPhone, setRedeemPhone] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemResult, setRedeemResult] = useState<{ success: boolean; message: string } | null>(null);

  const setSetting = <K extends keyof LoyaltySettings>(k: K) => (v: LoyaltySettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));

  const saveSettings = async () => {
    setSaving(true);
    setSettingsError(null);
    try {
      const res = await fetch("/api/admin/loyalty/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const d = await res.json();
        setSettingsError(d.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    try {
      const res = await fetch("/api/admin/loyalty/customers");
      if (res.ok) {
        const d = await res.json();
        setCustomers(d.customers ?? []);
        setAnalytics(d.analytics ?? null);
      }
    } finally {
      setLoadingCustomers(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "customers" || tab === "analytics") loadCustomers();
  }, [tab, loadCustomers]);

  const handleRedeem = async (phone: string) => {
    setRedeemLoading(true);
    setRedeemResult(null);
    try {
      const res = await fetch("/api/admin/loyalty/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const d = await res.json();
      if (res.ok) {
        setRedeemResult({ success: true, message: "Reward redeemed successfully!" });
        loadCustomers();
      } else {
        setRedeemResult({ success: false, message: d.error ?? "Redemption failed" });
      }
    } finally {
      setRedeemLoading(false);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.phone.includes(search) ||
      c.name.toLowerCase().includes(search.toLowerCase())
  );

  const previewTicks = Math.min(Math.floor(settings.tickGoal * 0.6), settings.tickGoal - 1);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-24 md:pb-8 space-y-6">
      {/* Header + global toggle */}
      <div className="flex items-start gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Loyalty Program</h1>
          <p className="text-sm text-gray-500 mt-1">
            Reward customers for coming back — ticks → free reward.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => {
              setSetting("enabled")(!settings.enabled);
              setSaved(false);
            }}
            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors ${
              settings.enabled ? "bg-orange-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                settings.enabled ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        )}
      </div>

      {!settings.enabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex gap-3">
          <span className="text-xl flex-shrink-0">💡</span>
          <div>
            <p className="font-black text-amber-900 text-sm mb-1">Loyalty Program is off</p>
            <p className="text-amber-800 text-sm">
              Toggle on to start rewarding customers automatically after paid orders.
            </p>
          </div>
        </div>
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 bg-gray-200 rounded-xl p-1">
        {(["settings", "customers", "analytics"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-black rounded-lg capitalize transition-all ${
              tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Settings tab ─────────────────────────────────────────────────── */}
      {tab === "settings" && (
        <div className="space-y-5">
          {/* Stamp card preview */}
          <StampCard
            current={previewTicks}
            goal={settings.tickGoal}
            reward={settings.reward || "Free reward"}
            restaurantName={restaurantName}
          />

          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-6">
            {/* Tick goal */}
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-3">
                Tick Goal — How many orders to unlock reward
              </label>
              <div className="flex gap-2 flex-wrap">
                {[5, 10, 15, 20].map((n) => (
                  <button
                    key={n}
                    disabled={!canEdit}
                    onClick={() => setSetting("tickGoal")(n)}
                    className={`px-5 py-2.5 rounded-xl font-black text-sm transition-all ${
                      settings.tickGoal === n
                        ? "bg-orange-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {n} ticks
                  </button>
                ))}
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={settings.tickGoal}
                    onChange={(e) => setSetting("tickGoal")(Math.max(1, Math.min(50, Number(e.target.value))))}
                    disabled={!canEdit}
                    className="w-20 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold text-center outline-none focus:border-orange-500 disabled:bg-gray-50"
                  />
                  <span className="text-sm text-gray-400">custom</span>
                </div>
              </div>
            </div>

            {/* Reward */}
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-2">
                Reward — What customers unlock
              </label>
              <input
                value={settings.reward}
                onChange={(e) => setSetting("reward")(e.target.value)}
                placeholder="Free Shawarma, Free Coke, ₦2,000 discount..."
                disabled={!canEdit}
                maxLength={80}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500 disabled:bg-gray-50"
              />
              <div className="flex gap-2 mt-2 flex-wrap">
                {["Free meal", "Free drink", "Free dessert", "₦2,000 off", "Free delivery"].map((r) => (
                  <button
                    key={r}
                    disabled={!canEdit}
                    onClick={() => setSetting("reward")(r)}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Qualification rule */}
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-3">
                Qualification Rule — Which orders earn a tick
              </label>
              <div className="space-y-2">
                <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${settings.qualificationRule === "every_order" ? "border-orange-500 bg-orange-50" : "border-gray-200 hover:bg-gray-50"}`}>
                  <input
                    type="radio"
                    name="qualRule"
                    checked={settings.qualificationRule === "every_order"}
                    onChange={() => setSetting("qualificationRule")("every_order")}
                    disabled={!canEdit}
                    className="accent-orange-600"
                  />
                  <div>
                    <p className="font-black text-sm text-gray-800">Every paid order</p>
                    <p className="text-xs text-gray-500">Customer earns a tick on every successful payment</p>
                  </div>
                </label>
                <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${settings.qualificationRule === "min_amount" ? "border-orange-500 bg-orange-50" : "border-gray-200 hover:bg-gray-50"}`}>
                  <input
                    type="radio"
                    name="qualRule"
                    checked={settings.qualificationRule === "min_amount"}
                    onChange={() => setSetting("qualificationRule")("min_amount")}
                    disabled={!canEdit}
                    className="accent-orange-600 mt-0.5"
                  />
                  <div className="flex-1">
                    <p className="font-black text-sm text-gray-800">Orders above minimum amount</p>
                    {settings.qualificationRule === "min_amount" && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm text-gray-500">₦</span>
                        <input
                          type="number"
                          min={0}
                          value={settings.minimumAmount}
                          onChange={(e) => setSetting("minimumAmount")(Number(e.target.value))}
                          disabled={!canEdit}
                          className="w-28 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-orange-500"
                          placeholder="5000"
                        />
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </div>

            {/* After reward */}
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-3">
                After Reward is Earned
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: false, label: "Reset ticks", desc: "Start fresh from 0" },
                  { v: true, label: "Carry over", desc: "Extra ticks roll to next reward" },
                ].map(({ v, label, desc }) => (
                  <button
                    key={String(v)}
                    disabled={!canEdit}
                    onClick={() => setSetting("rolloverAfterReward")(v)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      settings.rolloverAfterReward === v
                        ? "border-orange-500 bg-orange-50"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <p className="font-black text-sm text-gray-800">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {settingsError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-medium px-4 py-3 rounded-xl">
                {settingsError}
              </div>
            )}

            {canEdit && (
              <button
                onClick={saveSettings}
                disabled={saving}
                className="w-full py-3 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white font-black text-sm rounded-xl transition-colors"
              >
                {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Settings"}
              </button>
            )}
          </div>

          {/* Message preview */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-3">
            <h2 className="font-black text-gray-900 text-sm">Customer Experience Preview</h2>
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-100 rounded-xl">
                <span className="text-base">🎉</span>
                <p>You earned a loyalty tick! <strong>{previewTicks + 1}/{settings.tickGoal}</strong> completed.</p>
              </div>
              <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                <span className="text-base">🍔</span>
                <p>Only <strong>{settings.tickGoal - previewTicks - 1}</strong> more {settings.tickGoal - previewTicks - 1 === 1 ? "order" : "orders"} until your <strong>{settings.reward || "free reward"}</strong>!</p>
              </div>
              <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-100 rounded-xl">
                <span className="text-base">🎁</span>
                <p>Congratulations! You unlocked a <strong>{settings.reward || "free reward"}</strong>!</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Customers tab ─────────────────────────────────────────────────── */}
      {tab === "customers" && (
        <div className="space-y-4">
          {/* Redeem widget */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-black text-gray-900 mb-3">Redeem Customer Reward</h2>
            <p className="text-sm text-gray-500 mb-4">Enter customer phone to redeem their earned reward.</p>
            <div className="flex gap-3">
              <input
                type="tel"
                value={redeemPhone}
                onChange={(e) => { setRedeemPhone(e.target.value); setRedeemResult(null); }}
                placeholder="+2348012345678"
                className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500"
              />
              <button
                onClick={() => handleRedeem(redeemPhone)}
                disabled={redeemLoading || !redeemPhone.trim()}
                className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 text-white font-black text-sm rounded-xl transition-colors"
              >
                {redeemLoading ? "..." : "Redeem"}
              </button>
            </div>
            {redeemResult && (
              <div className={`mt-3 p-3 rounded-xl text-sm font-medium ${redeemResult.success ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
                {redeemResult.message}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by phone or name..."
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500 bg-white"
            />
          </div>

          {loadingCustomers ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-white rounded-2xl border border-gray-100 animate-pulse" />
              ))}
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <p className="text-4xl mb-3">🎯</p>
              <p className="font-black text-gray-700">No loyalty customers yet</p>
              <p className="text-sm text-gray-400 mt-1">
                {settings.enabled
                  ? "Customers will appear here after their first paid order."
                  : "Enable the loyalty program first."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCustomers.map((customer) => {
                const hasReward = customer.unredeemedRewards > 0;
                return (
                  <div
                    key={customer.phone}
                    className={`bg-white rounded-2xl border p-5 ${hasReward ? "border-orange-200 bg-orange-50/30" : "border-gray-100"}`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="font-black text-gray-900">{customer.name || "Customer"}</p>
                        <p className="text-xs text-gray-400 font-mono">{customer.phone}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {hasReward ? (
                          <div className="space-y-1">
                            <span className="inline-block bg-orange-100 text-orange-700 text-xs font-black px-2.5 py-1 rounded-full">
                              🎁 {customer.unredeemedRewards} reward{customer.unredeemedRewards > 1 ? "s" : ""} ready
                            </span>
                            {canEdit && (
                              <button
                                onClick={() => handleRedeem(customer.phone)}
                                disabled={redeemLoading}
                                className="block w-full text-xs font-black text-orange-600 hover:text-orange-800 transition-colors"
                              >
                                Redeem →
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 font-medium">
                            {customer.rewardsRedeemed} redeemed
                          </span>
                        )}
                      </div>
                    </div>
                    <TickBar current={customer.currentTicks} goal={settings.tickGoal} />
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span>{customer.totalTicks} total ticks</span>
                      <span>{customer.rewardsEarned} rewards earned</span>
                      {customer.lastEarnedAt && (
                        <span>last: {new Date(customer.lastEarnedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Analytics tab ─────────────────────────────────────────────────── */}
      {tab === "analytics" && (
        <div className="space-y-4">
          {loadingCustomers ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 bg-white rounded-2xl border border-gray-100 animate-pulse" />
              ))}
            </div>
          ) : analytics ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Loyalty Customers", value: analytics.totalCustomers, icon: "👥", color: "text-blue-600 bg-blue-50" },
                  { label: "Near Reward", value: analytics.nearReward, icon: "🎯", color: "text-orange-600 bg-orange-50" },
                  { label: "Rewards Earned", value: analytics.totalRewardsEarned, icon: "🎁", color: "text-green-600 bg-green-50" },
                  { label: "Rewards Redeemed", value: analytics.totalRewardsRedeemed, icon: "✅", color: "text-purple-600 bg-purple-50" },
                ].map(({ label, value, icon, color }) => (
                  <div key={label} className="bg-white rounded-2xl border border-gray-100 p-5">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-3 ${color}`}>
                      {icon}
                    </div>
                    <p className="text-2xl font-black text-gray-900">{value}</p>
                    <p className="text-xs text-gray-500 font-medium mt-1">{label}</p>
                  </div>
                ))}
              </div>

              {analytics.pendingRedemptions > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 flex items-center gap-4">
                  <span className="text-2xl">🎁</span>
                  <div>
                    <p className="font-black text-orange-900">
                      {analytics.pendingRedemptions} customer{analytics.pendingRedemptions > 1 ? "s" : ""} with unredeemed rewards
                    </p>
                    <p className="text-sm text-orange-700">
                      Switch to the Customers tab to process redemptions.
                    </p>
                  </div>
                </div>
              )}

              {/* Near reward customers */}
              {customers.filter((c) => c.unredeemedRewards > 0).length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 p-5">
                  <h3 className="font-black text-gray-900 mb-4">Ready for Redemption</h3>
                  <div className="space-y-3">
                    {customers.filter((c) => c.unredeemedRewards > 0).map((c) => (
                      <div key={c.phone} className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-sm text-gray-800">{c.name || "Customer"}</p>
                          <p className="text-xs text-gray-400 font-mono">{c.phone}</p>
                        </div>
                        <span className="text-xs font-black text-orange-700 bg-orange-50 px-2.5 py-1 rounded-full">
                          {c.unredeemedRewards} reward{c.unredeemedRewards > 1 ? "s" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analytics.totalCustomers === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
                  <p className="text-4xl mb-3">📊</p>
                  <p className="font-black text-gray-700">No data yet</p>
                  <p className="text-sm text-gray-400 mt-1">Analytics will appear after your first loyalty customers.</p>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
