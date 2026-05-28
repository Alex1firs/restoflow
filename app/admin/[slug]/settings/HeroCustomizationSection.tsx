"use client";

import { useRef, useCallback } from "react";
import type { HeroSettings } from "@/lib/hero-settings";

interface Props {
  settings: HeroSettings;
  onChange: (s: HeroSettings) => void;
  logoUrl: string;
  coverUrl: string;
  restaurantName: string;
  description: string;
}

const SCALE = 0.32;

export default function HeroCustomizationSection({ settings, onChange, logoUrl, coverUrl, restaurantName, description }: Props) {
  const set = <K extends keyof HeroSettings>(k: K, v: HeroSettings[K]) =>
    onChange({ ...settings, [k]: v });

  const focalRef = useRef<HTMLDivElement>(null);
  const logoFocalRef = useRef<HTMLDivElement>(null);

  const handleFocalClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = focalRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
      onChange({
        ...settings,
        focalPointX: Math.max(0, Math.min(100, x)),
        focalPointY: Math.max(0, Math.min(100, y)),
      });
    },
    [settings, onChange]
  );

  const handleLogoFocalClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = logoFocalRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
      onChange({
        ...settings,
        logoFocalX: Math.max(0, Math.min(100, x)),
        logoFocalY: Math.max(0, Math.min(100, y)),
      });
    },
    [settings, onChange]
  );

  const justifyClass =
    settings.textVerticalPosition === "top"
      ? "justify-start"
      : settings.textVerticalPosition === "middle"
      ? "justify-center"
      : "justify-end";

  const overlayStyle = {
    background: `linear-gradient(to top, rgba(0,0,0,${(settings.overlayOpacity / 100).toFixed(2)}) 0%, rgba(0,0,0,${(settings.overlayOpacity * 0.47 / 100).toFixed(2)}) 50%, rgba(0,0,0,${(settings.overlayOpacity * 0.12 / 100).toFixed(2)}) 100%)`,
  };

  const currentPosKey = `${settings.textVerticalPosition}-${settings.textAlign}`;

  return (
    <div className="space-y-8">

      {/* ── LIVE PREVIEW ─────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Live Preview</p>
        <div
          className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm bg-stone-900"
          style={{ height: "230px" }}
        >
          <div className={`relative w-full h-full flex flex-col ${justifyClass} overflow-hidden`}>
            {coverUrl && (
              <>
                <img
                  src={coverUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{
                    objectFit: settings.coverObjectFit,
                    objectPosition: `${settings.focalPointX}% ${settings.focalPointY}%`,
                    opacity: 0.9,
                  }}
                />
                <div className="absolute inset-0 pointer-events-none" style={overlayStyle} />
              </>
            )}

            {/* Navbar strip */}
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-4 py-3 bg-gradient-to-b from-black/50 to-transparent">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="logo"
                  style={{
                    width: Math.round(settings.logoWidth * SCALE),
                    height: Math.round(settings.logoHeight * SCALE),
                    borderRadius: Math.round(settings.logoBorderRadius * SCALE),
                    objectFit: settings.logoObjectFit,
                    objectPosition: `${settings.logoFocalX}% ${settings.logoFocalY}%`,
                    flexShrink: 0,
                    border: "1px solid rgba(255,255,255,0.2)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: Math.round(settings.logoWidth * SCALE),
                    height: Math.round(settings.logoHeight * SCALE),
                    borderRadius: Math.round(settings.logoBorderRadius * SCALE),
                    background: "rgba(255,255,255,0.15)",
                    flexShrink: 0,
                  }}
                />
              )}
              <span className="text-white font-black text-[9px] tracking-tight drop-shadow-sm select-none">{restaurantName}</span>
            </div>

            {/* Hero text */}
            <div
              className="relative z-10 w-full px-4"
              style={{
                paddingBottom: settings.textVerticalPosition === "bottom" ? "16px" : undefined,
                paddingTop: settings.textVerticalPosition === "top" ? "44px" : undefined,
                textAlign: settings.textAlign,
              }}
            >
              <div
                className="font-black text-white drop-shadow-md leading-none"
                style={{
                  fontSize: Math.round(settings.headingSize * SCALE),
                  lineHeight: settings.lineHeight / 100,
                  letterSpacing: `${settings.letterSpacing * 0.01}em`,
                }}
              >
                {restaurantName}
              </div>
              {description && (
                <div
                  className="text-white/80 font-medium mt-1"
                  style={{
                    fontSize: Math.round(settings.subtitleSize * SCALE),
                    lineHeight: settings.lineHeight / 100,
                    letterSpacing: `${settings.letterSpacing * 0.01}em`,
                  }}
                >
                  {description}
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 text-center">All changes reflect here instantly</p>
      </div>

      {/* ── LOGO DISPLAY ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide border-t border-gray-100 pt-5">Logo Display</p>
        <div className="flex items-start gap-5">
          {/* Live logo preview */}
          <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="logo"
                style={{
                  width: settings.logoWidth,
                  height: settings.logoHeight,
                  borderRadius: settings.logoBorderRadius,
                  objectFit: settings.logoObjectFit,
                  objectPosition: `${settings.logoFocalX}% ${settings.logoFocalY}%`,
                  border: "2px solid #e5e7eb",
                  display: "block",
                }}
              />
            ) : (
              <div
                style={{
                  width: Math.max(settings.logoWidth, 40),
                  height: Math.max(settings.logoHeight, 40),
                  borderRadius: settings.logoBorderRadius,
                  background: "#f3f4f6",
                  border: "2px dashed #d1d5db",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span className="text-gray-400 text-[10px] font-bold">No logo</span>
              </div>
            )}
            <span className="text-[10px] text-gray-400">{settings.logoWidth}×{settings.logoHeight}px</span>
          </div>

          <div className="flex-1 space-y-3">
            <Slider label={`Width: ${settings.logoWidth}px`} min={24} max={120} value={settings.logoWidth} onChange={(v) => set("logoWidth", v)} />
            <Slider label={`Height: ${settings.logoHeight}px`} min={24} max={120} value={settings.logoHeight} onChange={(v) => set("logoHeight", v)} />
            <Slider label={`Corner radius: ${settings.logoBorderRadius}px`} min={0} max={60} value={settings.logoBorderRadius} onChange={(v) => set("logoBorderRadius", v)} />
            <div>
              <p className="text-xs text-gray-400 mb-1.5">Image fit</p>
              <ToggleGroup
                options={[
                  { value: "cover", label: "Fill & Crop" },
                  { value: "contain", label: "Show Full" },
                ]}
                value={settings.logoObjectFit}
                onChange={(v) => set("logoObjectFit", v as "cover" | "contain")}
              />
            </div>
          </div>
        </div>

        {logoUrl && settings.logoObjectFit === "cover" && (
          <div>
            <p className="text-xs text-gray-400 mb-1.5">
              Logo focus point <span className="text-gray-300 font-normal">(click image to pin)</span>
            </p>
            <div
              ref={logoFocalRef}
              onClick={handleLogoFocalClick}
              className="relative rounded-xl overflow-hidden cursor-crosshair border border-gray-200 select-none"
              style={{ height: 80 }}
            >
              <img src={logoUrl} alt="" className="w-full h-full object-cover" />
              <div
                className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md bg-orange-500 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{ left: `${settings.logoFocalX}%`, top: `${settings.logoFocalY}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── COVER IMAGE ──────────────────────────────────────────── */}
      <div className="space-y-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide border-t border-gray-100 pt-5">Cover Image</p>
        <Slider label={`Hero height: ${settings.heroHeight}vh`} min={30} max={100} value={settings.heroHeight} onChange={(v) => set("heroHeight", v)} />
        <Slider label={`Overlay darkness: ${settings.overlayOpacity}%`} min={0} max={100} value={settings.overlayOpacity} onChange={(v) => set("overlayOpacity", v)} />
        <div>
          <p className="text-xs text-gray-400 mb-1.5">Image fit</p>
          <ToggleGroup
            options={[
              { value: "cover", label: "Fill & Crop" },
              { value: "contain", label: "Show Full" },
            ]}
            value={settings.coverObjectFit}
            onChange={(v) => set("coverObjectFit", v as "cover" | "contain")}
          />
        </div>

        {coverUrl && (
          <div>
            <p className="text-xs text-gray-400 mb-1.5">
              Focus point <span className="text-gray-300 font-normal">(click to set what stays in frame)</span>
            </p>
            <div
              ref={focalRef}
              onClick={handleFocalClick}
              className="relative rounded-xl overflow-hidden cursor-crosshair border border-gray-200 select-none"
              style={{ height: 130 }}
            >
              <img src={coverUrl} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/20 pointer-events-none" />
              <div
                className="absolute w-5 h-5 rounded-full border-2 border-white shadow-lg bg-orange-500 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{ left: `${settings.focalPointX}%`, top: `${settings.focalPointY}%` }}
              />
              <div className="absolute bottom-1.5 right-2 text-[9px] text-white/60 pointer-events-none">
                {settings.focalPointX}% · {settings.focalPointY}%
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── HERO TEXT ────────────────────────────────────────────── */}
      <div className="space-y-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide border-t border-gray-100 pt-5">Hero Text</p>

        {/* 9-point position grid */}
        <div>
          <p className="text-xs text-gray-400 mb-2">Text position</p>
          <div className="grid grid-cols-3 gap-1.5 w-fit">
            {(["top", "middle", "bottom"] as const).map((v) =>
              (["left", "center", "right"] as const).map((a) => {
                const key = `${v}-${a}`;
                const active = currentPosKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    title={`${v} ${a}`}
                    onClick={() => onChange({ ...settings, textVerticalPosition: v, textAlign: a })}
                    className={`w-11 h-11 rounded-xl border-2 transition-all flex items-center justify-center ${
                      active ? "border-orange-500 bg-orange-50" : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <PosDot v={v} a={a} active={active} />
                  </button>
                );
              })
            )}
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">
            Selected: <span className="font-bold text-gray-600">{settings.textVerticalPosition} · {settings.textAlign}</span>
          </p>
        </div>

        <Slider label={`Heading size: ${settings.headingSize}px`} min={20} max={96} value={settings.headingSize} onChange={(v) => set("headingSize", v)} />
        <Slider label={`Subtitle size: ${settings.subtitleSize}px`} min={10} max={32} value={settings.subtitleSize} onChange={(v) => set("subtitleSize", v)} />
        <Slider
          label={`Line height: ${(settings.lineHeight / 100).toFixed(2)}`}
          min={80}
          max={300}
          value={settings.lineHeight}
          onChange={(v) => set("lineHeight", v)}
        />
        <Slider
          label={`Letter spacing: ${settings.letterSpacing > 0 ? "+" : ""}${settings.letterSpacing} (${(settings.letterSpacing * 0.01).toFixed(2)}em)`}
          min={-10}
          max={30}
          value={settings.letterSpacing}
          onChange={(v) => set("letterSpacing", v)}
        />
      </div>
    </div>
  );
}

function Slider({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-orange-500 cursor-pointer"
      />
    </div>
  );
}

function ToggleGroup({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
            value === o.value
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PosDot({ v, a, active }: { v: "top" | "middle" | "bottom"; a: "left" | "center" | "right"; active: boolean }) {
  const cx = a === "left" ? 7 : a === "center" ? 12 : 17;
  const cy = v === "top" ? 7 : v === "middle" ? 12 : 17;
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="3" fill={active ? "#fff7ed" : "#f9fafb"} stroke={active ? "#f97316" : "#e5e7eb"} strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r="2.5" fill={active ? "#f97316" : "#9ca3af"} />
    </svg>
  );
}
