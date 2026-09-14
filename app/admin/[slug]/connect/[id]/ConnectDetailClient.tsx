"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check, Loader2, Phone } from "lucide-react";
import type { MerchantDelivery, MerchantStage } from "@/lib/connect/merchant-view";

/**
 * One delivery, from the counter's point of view.
 *
 * The lifecycle is shown as a list rather than a status word, because the
 * question an operator actually has is "where has this got to" — and a single
 * label answers that only if you already know what the labels mean.
 */

const naira = (m: number) => "₦" + (m / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 });

/** The happy path, in the order it happens. Exceptions are shown separately. */
const JOURNEY: { stage: MerchantStage; label: string }[] = [
  { stage: "draft", label: "Created" },
  { stage: "awaiting_payment", label: "Waiting for payment" },
  { stage: "paid", label: "Paid" },
  { stage: "finding_courier", label: "Finding courier" },
  { stage: "courier_assigned", label: "Courier assigned" },
  { stage: "at_restaurant", label: "At your restaurant" },
  { stage: "picked_up", label: "Picked up" },
  { stage: "on_the_way", label: "On the way" },
  { stage: "delivered", label: "Delivered" },
];

const EXCEPTION: Partial<Record<MerchantStage, { label: string; detail: string; tone: string }>> = {
  unfulfilled: {
    label: "Couldn't be delivered",
    detail: "The payment is being returned to whoever paid it.",
    tone: "bg-red-50 border-red-200 text-red-800",
  },
  refund_pending: { label: "Refund in progress", detail: "The payment is on its way back.", tone: "bg-amber-50 border-amber-200 text-amber-800" },
  refunded: { label: "Refunded", detail: "The payment has been returned.", tone: "bg-gray-50 border-gray-200 text-gray-700" },
  refund_failed: { label: "Refund needs attention", detail: "Our team is completing it.", tone: "bg-red-50 border-red-200 text-red-800" },
  cancelled: { label: "Cancelled", detail: "This delivery was cancelled.", tone: "bg-gray-50 border-gray-200 text-gray-700" },
};

export default function ConnectDetailClient({ slug, id }: { slug: string; id: string }) {
  const [d, setD] = useState<MerchantDelivery | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/connect/deliveries/${id}`, { cache: "no-store" });
      if (res.status === 404) { setMissing(true); return; }
      if (!res.ok) return;
      const j = (await res.json()) as { delivery: MerchantDelivery };
      setD(j.delivery);
    } catch {
      // Keep what is on screen.
    }
  }, [id]);

  // Same reason as the board: payment and courier state both change without
  // anybody touching this page.
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  if (missing) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-center">
        <p className="font-black text-gray-900">Delivery not found</p>
        <Link href={`/admin/${slug}/connect`} className="text-sm font-bold text-orange-600 mt-2 inline-block">
          Back to Connect
        </Link>
      </div>
    );
  }

  if (!d) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm py-16 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  const exception = EXCEPTION[d.stage];
  const reached = JOURNEY.findIndex((s) => s.stage === d.stage);

  const copyLink = async () => {
    if (!d.trackingUrl) return;
    await navigator.clipboard.writeText(d.trackingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-20 md:pb-6">
      <Link href={`/admin/${slug}/connect`} className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> Connect
      </Link>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-black text-gray-900 truncate">{d.customerName}</h1>
            <p className="text-sm text-gray-500">{d.destination}</p>
          </div>
          {d.priceMinor != null && (
            <div className="text-right shrink-0">
              <p className="text-xl font-black text-gray-900">{naira(d.priceMinor)}</p>
              <p className="text-xs font-bold text-gray-500">
                {d.payer === "customer" ? "Customer pays" : d.payer === "restaurant" ? "You pay" : ""}
                {d.paid ? " · Paid" : ""}
              </p>
            </div>
          )}
        </div>

        <a href={`tel:${d.customerPhone}`} className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-700 mt-3">
          <Phone className="w-4 h-4" /> {d.customerPhone}
        </a>

        <dl className="mt-4 pt-4 border-t border-gray-100 space-y-2 text-sm">
          <Row label="Package" value={d.packageDescription} />
          <Row label="Ready" value={new Date(d.readyAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
          {d.courierFirstName && <Row label="Courier" value={d.courierFirstName} />}
        </dl>

        {/* The restaurant's own code, and only once a rider is actually coming. */}
        {d.pickupCode && (
          <div className="mt-4 bg-orange-50 border border-orange-200 rounded-xl p-4 text-center">
            <p className="text-xs font-black text-orange-700 uppercase tracking-wide">Give the order to the rider who says</p>
            <p className="text-3xl font-black text-orange-900 tracking-[0.2em] mt-1">{d.pickupCode}</p>
          </div>
        )}
      </div>

      {exception ? (
        <div className={`mt-4 rounded-2xl border p-4 ${exception.tone}`}>
          <p className="font-black">{exception.label}</p>
          <p className="text-sm mt-0.5">{exception.detail}</p>
        </div>
      ) : (
        <div className="mt-4 bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-xs font-black text-gray-500 uppercase tracking-wide mb-4">Progress</h2>
          <ol className="space-y-3">
            {JOURNEY.map((step, i) => {
              const done = reached >= 0 && i < reached;
              const now = i === reached;
              return (
                <li key={step.stage} className="flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    now ? "bg-orange-500 animate-pulse" : done ? "bg-green-500" : "bg-gray-200"
                  }`} />
                  <span className={`text-sm ${now ? "font-black text-gray-900" : done ? "font-bold text-gray-600" : "font-medium text-gray-400"}`}>
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {d.trackingUrl && (
        <div className="mt-4 bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-xs font-black text-gray-500 uppercase tracking-wide mb-2">
            {d.paid ? "Customer tracking link" : "Customer payment link"}
          </h2>
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-mono break-all text-gray-700">
            {d.trackingUrl}
          </div>
          <button onClick={copyLink} className="w-full mt-3 bg-gray-900 text-white rounded-xl py-2.5 font-black text-sm flex items-center justify-center gap-2">
            {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy link</>}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500 font-medium shrink-0">{label}</dt>
      <dd className="font-bold text-gray-900 text-right">{value}</dd>
    </div>
  );
}
