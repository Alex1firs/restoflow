"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, MapPin, Check, Loader2 } from "lucide-react";

/**
 * Place the pin where the courier is actually going.
 *
 * ── Why a map and not two number fields ──────────────────────────────────────
 * The coordinates are authoritative — they are what the rider is routed to —
 * but nobody behind a counter thinks in decimal degrees. So the operator does
 * the thing they already know how to do: look at a map, tap the building, drag
 * until it is right. The numbers exist and are stored; they are simply never
 * something staff has to see or type.
 *
 * ── Leaflet and OpenStreetMap, deliberately ──────────────────────────────────
 * No API key, no per-load billing, and attribution is a licence condition
 * rather than a nicety — it is rendered below, always.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 * It is not address search. Typing an address does not move the pin, because
 * OSM's public Nominatim endpoint is not a production geocoding service and
 * treating it as one would work in testing and rate-limit in the evening rush.
 * Autocomplete needs a real provider, and that is a decision on its own.
 *
 * Leaflet is loaded on demand so its CSS and 140KB never reach the pages that
 * do not show a map.
 */

/** Lagos, so a fresh map opens somewhere recognisable rather than in the ocean. */
const FALLBACK_CENTER: [number, number] = [6.5244, 3.3792];

export type Coords = { lat: number; lng: number };

export default function LocationPicker({
  value,
  onChange,
  initialCenter,
}: {
  value: Coords | null;
  onChange: (c: Coords | null) => void;
  /** Usually the restaurant, so the map opens near the deliveries it will make. */
  initialCenter?: Coords | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Keep the latest callback without re-running the map setup.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      // Leaflet's stylesheet has to be present or the tiles stack diagonally.
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      if (cancelled || !hostRef.current || mapRef.current) return;

      const center: [number, number] = value
        ? [value.lat, value.lng]
        : initialCenter
          ? [initialCenter.lat, initialCenter.lng]
          : FALLBACK_CENTER;

      const map = L.map(hostRef.current, {
        center,
        zoom: value ? 17 : 14,
        // A map inside a scrolling form must not eat the page scroll on a
        // phone. Two fingers pans; one finger scrolls past it.
        dragging: true,
        scrollWheelZoom: false,
        tap: true,
      });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        // Licence condition, not decoration.
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const icon = L.divIcon({
        className: "",
        html: `<div style="width:26px;height:26px;border-radius:50%;background:#f97316;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      const place = (lat: number, lng: number) => {
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          const m = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
          m.on("dragend", () => {
            const p = m.getLatLng();
            onChangeRef.current({ lat: p.lat, lng: p.lng });
          });
          markerRef.current = m;
        }
        onChangeRef.current({ lat, lng });
      };

      map.on("click", (e: import("leaflet").LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));
      if (value) place(value.lat, value.lng);

      mapRef.current = map;
      setReady(true);
      // The container is sized by CSS that settles after mount; without this
      // the tiles render into a zero-height box and the map looks broken.
      setTimeout(() => map.invalidateSize(), 60);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Set up once. Later `value` changes come from this component itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useDevice = () => {
    setNote(null);
    if (!navigator.geolocation) { setNote("This device can't share its location."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        const { latitude: lat, longitude: lng } = p.coords;
        mapRef.current?.setView([lat, lng], 17);
        mapRef.current?.fire("click", { latlng: { lat, lng } });
      },
      () => {
        setLocating(false);
        setNote("Couldn't read this device's location. Tap the map instead.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-black text-gray-500 uppercase tracking-wide">
          Delivery location
        </label>
        <button
          type="button"
          onClick={useDevice}
          className="flex items-center gap-1.5 text-xs font-black text-gray-600 hover:text-gray-900"
        >
          {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
          Use my location
        </button>
      </div>

      <div className="relative rounded-xl overflow-hidden border border-gray-200">
        <div ref={hostRef} className="h-56 sm:h-64 w-full bg-gray-100" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading map…
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-1.5">
        {value
          ? "Drag the pin to fine-tune the exact door."
          : "Tap the map where the order is going."}
      </p>

      {value ? (
        <div className="mt-2 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
          <Check className="w-4 h-4 text-green-700 shrink-0" />
          <span className="text-sm font-bold text-green-800">Delivery location confirmed</span>
          <button
            type="button"
            onClick={() => {
              markerRef.current?.remove();
              markerRef.current = null;
              onChange(null);
            }}
            className="ml-auto text-xs font-black text-green-700 hover:text-green-900"
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
          <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="text-sm font-bold text-gray-500">No location set yet</span>
        </div>
      )}

      {note && <p className="text-xs font-bold text-amber-700 mt-1.5">{note}</p>}
    </div>
  );
}
