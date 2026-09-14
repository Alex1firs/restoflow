"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Truck, Copy, Check, Share2, MapPin, Loader2 } from "lucide-react";
import type { MerchantDelivery } from "@/lib/connect/merchant-view";

/**
 * RestoFlow Connect — the operator's screen.
 *
 * ── Written for somebody behind a counter ────────────────────────────────────
 * The person using this took an order on WhatsApp thirty seconds ago and has a
 * customer waiting. So the whole job is one column: who it goes to, what it is,
 * when it is ready, what it costs, who pays. No tabs, no wizard chrome, and
 * nothing on screen that does not help them get a rider moving.
 *
 * Dispatcher's vocabulary never appears. "SEARCHING_FOR_DRIVER" means nothing
 * behind a counter; "Finding a courier" does.
 */

const naira = (minor: number) => "₦" + (minor / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 });

const STAGE_TONE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  awaiting_payment: "bg-amber-100 text-amber-800",
  paid: "bg-blue-100 text-blue-800",
  finding_courier: "bg-blue-100 text-blue-800",
  courier_assigned: "bg-indigo-100 text-indigo-800",
  at_restaurant: "bg-orange-100 text-orange-800",
  picked_up: "bg-orange-100 text-orange-800",
  on_the_way: "bg-orange-100 text-orange-800",
  delivered: "bg-green-100 text-green-800",
  unfulfilled: "bg-red-100 text-red-800",
  refund_pending: "bg-amber-100 text-amber-800",
  refunded: "bg-gray-200 text-gray-700",
  refund_failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-200 text-gray-700",
};

const ACTIVE = new Set(["awaiting_payment", "paid", "finding_courier", "courier_assigned", "at_restaurant", "picked_up", "on_the_way"]);

export default function ConnectClient({
  slug, pickup,
}: {
  slug: string;
  pickup: { name: string; address: string };
}) {
  const [rows, setRows] = useState<MerchantDelivery[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/connect/deliveries", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { deliveries: MerchantDelivery[] };
      setRows(j.deliveries);
    } catch {
      // Keep the last good list: an empty board and an unreachable one look the
      // same to an operator, and only one of them means "stop waiting".
    }
  }, []);

  // The board polls while somebody is looking at it. Payment lands on a webhook
  // and the courier state changes behind that, so an operator who has just sent
  // a link should not have to think about refreshing.
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  const active = (rows ?? []).filter((r) => ACTIVE.has(r.stage));
  const recent = (rows ?? []).filter((r) => !ACTIVE.has(r.stage));

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-20 md:pb-6">
      <div className="flex justify-between items-start mb-6 gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Connect</h1>
          <p className="text-gray-500 text-sm font-medium">
            Send a courier for an order that came in anywhere — WhatsApp, Instagram, the phone.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2.5 rounded-xl font-black text-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> New delivery
        </button>
      </div>

      {creating && (
        <NewDelivery
          pickup={pickup}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void load(); }}
        />
      )}

      {rows === null && (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading deliveries…
        </div>
      )}

      {rows !== null && rows.length === 0 && !creating && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
          <Truck className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="font-black text-gray-900">No deliveries yet</p>
          <p className="text-gray-500 text-sm mt-1">
            Got an order by phone or WhatsApp? Send a courier for it.
          </p>
        </div>
      )}

      {active.length > 0 && <Section title="Active" rows={active} slug={slug} />}
      {recent.length > 0 && <Section title="Recent" rows={recent} slug={slug} />}
    </div>
  );
}

function Section({ title, rows, slug }: { title: string; rows: MerchantDelivery[]; slug: string }) {
  return (
    <div className="mb-8">
      <h2 className="text-xs font-black text-gray-500 uppercase tracking-wide mb-3">{title}</h2>
      <div className="space-y-2">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/admin/${slug}/connect/${r.id}`}
            className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-orange-300 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-black text-gray-900 truncate">{r.customerName}</p>
                <p className="text-sm text-gray-500 truncate">{r.destination}</p>
              </div>
              <span className={`shrink-0 text-xs font-black px-2.5 py-1 rounded-lg ${STAGE_TONE[r.stage] ?? "bg-gray-100 text-gray-700"}`}>
                {r.stageLabel}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-3 text-xs font-bold text-gray-500 flex-wrap">
              {r.priceMinor != null && <span className="text-gray-900">{naira(r.priceMinor)}</span>}
              {r.payer && <span>{r.payer === "customer" ? "Customer pays" : "You pay"}</span>}
              {r.paid && <span className="text-green-600">Paid</span>}
              {r.courierFirstName && <span>Courier: {r.courierFirstName}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** The form. Five things, in the order an operator already has them. */
function NewDelivery({
  pickup, onClose, onCreated,
}: {
  pickup: { name: string; address: string };
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pkg, setPkg] = useState("1 food package");
  const [readyInMins, setReadyInMins] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<MerchantDelivery | null>(null);

  const getQuote = async () => {
    setError(null);
    if (!coords) { setError("Confirm the delivery location first."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/connect/deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dropoff: { name, contactPhone: phone, address, location: coords },
          packageDescription: pkg,
          readyInMins,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(
          j.error === "not_serviceable" ? "We can't deliver to that location right now."
          : j.error === "pickup_location_not_set" ? "Your restaurant location isn't set. Add it in Settings first."
          : "Couldn't get a quote. Please try again."
        );
        return;
      }
      setQuote(j.delivery as MerchantDelivery);
    } finally {
      setBusy(false);
    }
  };

  if (quote) return <WhoPays delivery={quote} onDone={onCreated} />;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-8">
      <div className="flex justify-between items-center mb-5">
        <h2 className="font-black text-gray-900">New delivery</h2>
        <button onClick={onClose} className="text-sm font-bold text-gray-500 hover:text-gray-900">Cancel</button>
      </div>

      {/* The restaurant never re-enters its own address. */}
      <div className="bg-gray-50 rounded-xl p-3 mb-5">
        <p className="text-xs font-black text-gray-500 uppercase tracking-wide">Collecting from</p>
        <p className="font-bold text-gray-900 text-sm mt-0.5">{pickup.name}</p>
        <p className="text-sm text-gray-500">{pickup.address}</p>
      </div>

      <div className="space-y-4">
        <Field label="Customer name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-orange-400" />
        </Field>
        <Field label="Phone number">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234…" inputMode="tel"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-orange-400" />
        </Field>
        <Field label="Delivery address">
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="17 Test Close, Yaba"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-orange-400" />
        </Field>

        <LocationConfirm coords={coords} onChange={setCoords} />

        <Field label="What's in the package">
          <input value={pkg} onChange={(e) => setPkg(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-orange-400" />
          <p className="text-xs text-gray-400 mt-1">The rider sees this. No need to list the food.</p>
        </Field>

        <Field label="Ready">
          <div className="flex gap-2 flex-wrap">
            {[0, 10, 15, 30, 45].map((m) => (
              <button key={m} type="button" onClick={() => setReadyInMins(m)}
                className={`px-3 py-2 rounded-xl text-sm font-black border transition-colors ${
                  readyInMins === m ? "bg-orange-500 border-orange-500 text-white" : "bg-white border-gray-200 text-gray-700"
                }`}>
                {m === 0 ? "Now" : `${m} min`}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {error && <p className="text-sm font-bold text-red-600 mt-4">{error}</p>}

      <button
        onClick={getQuote}
        disabled={busy || !name || phone.length < 10 || address.length < 6 || !coords}
        className="w-full mt-5 bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-3 font-black text-sm flex items-center justify-center gap-2"
      >
        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Getting quote…</> : "Get delivery quote"}
      </button>
    </div>
  );
}

/**
 * Confirm where the courier is actually going.
 *
 * The typed address is what a human reads; these coordinates are what the rider
 * is sent to, so they are captured explicitly rather than guessed from the text.
 * There is no embedded map here yet — RestoFlow has no map provider configured,
 * and adding one is a commercial decision rather than something to slip into a
 * form. Until then: the device's own location, or coordinates pasted from
 * whatever map the operator already uses.
 */
function LocationConfirm({
  coords, onChange,
}: {
  coords: { lat: number; lng: number } | null;
  onChange: (c: { lat: number; lng: number } | null) => void;
}) {
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const useDevice = () => {
    setErr(null);
    if (!navigator.geolocation) { setErr("This device can't share a location."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { onChange({ lat: p.coords.latitude, lng: p.coords.longitude }); setBusy(false); },
      () => { setErr("Couldn't read the location. Paste coordinates instead."); setBusy(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const applyManual = (v: string) => {
    setManual(v);
    const m = v.split(",").map((x) => Number(x.trim()));
    if (m.length === 2 && m.every(Number.isFinite) && Math.abs(m[0]) <= 90 && Math.abs(m[1]) <= 180) {
      onChange({ lat: m[0], lng: m[1] });
      setErr(null);
    } else {
      onChange(null);
    }
  };

  return (
    <Field label="Confirm delivery location">
      {coords ? (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm font-bold text-green-800">
            <MapPin className="w-4 h-4" /> Location confirmed
          </span>
          <button type="button" onClick={() => { onChange(null); setManual(""); }}
            className="text-xs font-black text-green-700 hover:text-green-900">Change</button>
        </div>
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={useDevice} disabled={busy}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-700 flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            Use this device&apos;s location
          </button>
          <input value={manual} onChange={(e) => applyManual(e.target.value)} placeholder="or paste coordinates: 6.5158, 3.3877"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-orange-400" />
        </div>
      )}
      {err && <p className="text-xs font-bold text-red-600 mt-1">{err}</p>}
    </Field>
  );
}

/** The quote, then the one decision that matters. */
function WhoPays({ delivery, onDone }: { delivery: MerchantDelivery; onDone: () => void }) {
  const [busy, setBusy] = useState<null | "customer" | "restaurant">(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (payer: "customer" | "restaurant") => {
    setBusy(payer); setError(null);
    try {
      const res = await fetch(`/api/admin/connect/deliveries/${delivery.id}/pay`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payer }),
      });
      const j = await res.json();
      if (!res.ok) { setError("Couldn't start the payment. Please try again."); return; }
      if (payer === "restaurant") { window.location.href = j.checkoutUrl; return; }
      setLink(j.payLink as string);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const share = async () => {
    if (!link) return;
    // The device's own share sheet. RestoFlow does not send the message — we
    // have no WhatsApp integration, and saying we do would be a lie the
    // operator only discovers when the customer never receives it.
    if (navigator.share) await navigator.share({ text: `Pay for your delivery: ${link}` }).catch(() => {});
  };

  if (link) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-8">
        <h2 className="font-black text-gray-900">Send this to your customer</h2>
        <p className="text-sm text-gray-500 mt-1">
          They pay {naira(delivery.priceMinor ?? 0)} on this link. The courier is requested automatically once they do.
        </p>
        <div className="mt-4 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-mono break-all text-gray-700">
          {link}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={copy} className="flex-1 bg-gray-900 text-white rounded-xl py-2.5 font-black text-sm flex items-center justify-center gap-2">
            {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy link</>}
          </button>
          <button onClick={share} className="flex-1 border border-gray-200 rounded-xl py-2.5 font-black text-sm flex items-center justify-center gap-2 text-gray-700">
            <Share2 className="w-4 h-4" /> Share
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 bg-amber-50 border border-amber-200 px-3 py-2.5 rounded-xl">
          <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
          <span className="text-sm font-black text-amber-800">Waiting for customer payment</span>
        </div>
        <button onClick={onDone} className="w-full mt-3 text-sm font-bold text-gray-500 hover:text-gray-900 py-2">
          Back to deliveries
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-8">
      <div className="text-center py-2">
        <p className="text-xs font-black text-gray-500 uppercase tracking-wide">Delivery</p>
        <p className="text-4xl font-black text-gray-900 mt-1">{naira(delivery.priceMinor ?? 0)}</p>
        <div className="flex items-center justify-center gap-3 mt-2 text-xs font-bold text-gray-500">
          {delivery.distanceKm != null && <span>{delivery.distanceKm} km</span>}
          {delivery.etaToDropoffMins != null && <span>about {delivery.etaToDropoffMins} min</span>}
        </div>
      </div>

      <p className="text-sm font-black text-gray-900 mt-5 mb-2">Who pays for this delivery?</p>
      <div className="space-y-2">
        <button onClick={() => choose("customer")} disabled={busy !== null}
          className="w-full bg-orange-500 disabled:bg-orange-300 text-white rounded-xl py-3 font-black text-sm flex items-center justify-center gap-2">
          {busy === "customer" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Customer pays — send a payment link
        </button>
        <button onClick={() => choose("restaurant")} disabled={busy !== null}
          className="w-full border border-gray-200 text-gray-800 rounded-xl py-3 font-black text-sm flex items-center justify-center gap-2">
          {busy === "restaurant" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          I&apos;ll pay for it
        </button>
      </div>
      {error && <p className="text-sm font-bold text-red-600 mt-3">{error}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-black text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  );
}
