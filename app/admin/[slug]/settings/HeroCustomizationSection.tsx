"use client";

import { useState } from "react";
import type { HeroSettings } from "@/lib/hero-settings";
import VisualCustomizer from "./VisualCustomizer";

interface Props {
  settings: HeroSettings;
  onChange: (s: HeroSettings) => void;
  logoUrl: string;
  coverUrl: string;
  restaurantName: string;
  description: string;
  primaryColor: string;
  accentColor: string;
  onSave?: () => Promise<void>;
  saving?: boolean;
  slug?: string;
}

export default function HeroCustomizationSection({
  settings,
  onChange,
  logoUrl,
  coverUrl,
  restaurantName,
  description,
  primaryColor,
  accentColor,
  onSave,
  saving = false,
  slug,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* ── VISUAL WORKBENCH BANNER ──────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden border border-[#EFECE6] bg-[#FAF9F5] shadow-sm flex flex-col md:flex-row items-center gap-6 p-6">
        
        {/* Subtle grid background */}
        <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:12px_12px] opacity-40 pointer-events-none" />

        {/* High-end mini visual preview mock */}
        <div className="relative w-full md:w-56 h-36 bg-stone-900 rounded-xl overflow-hidden flex flex-col justify-end p-3 flex-shrink-0 shadow border border-white/10">
          {coverUrl ? (
            <>
              <img
                src={coverUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-80"
                style={{
                  objectPosition: `${settings.focalPointX}% ${settings.focalPointY}%`,
                }}
              />
              <div className="absolute inset-0 bg-black/40 pointer-events-none" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-tr from-stone-900 to-stone-800" />
          )}

          {/* Tiny logo badge */}
          {settings.showLogo && logoUrl && (
            <img
              src={logoUrl}
              alt=""
              className="absolute top-2.5 left-2.5 w-6 h-6 border border-white/20 shadow-sm bg-white"
              style={{
                borderRadius: `${settings.logoBorderRadius * 0.4}px`,
                objectFit: settings.logoObjectFit,
              }}
            />
          )}

          <div className="relative z-10 text-white">
            <h4 className="text-[10px] font-black tracking-tight leading-tight">{restaurantName}</h4>
            {settings.showSubtitle && description && (
              <p className="text-[8px] text-white/70 line-clamp-1 mt-0.5">{description}</p>
            )}
            
            {/* Tiny mock buttons */}
            <div className="flex gap-1 mt-2">
              <span
                style={{ backgroundColor: primaryColor }}
                className="w-10 h-2 rounded bg-orange-500 block opacity-95"
              />
              {settings.showSecondaryCta && (
                <span className="w-10 h-2 rounded bg-white/20 block" />
              )}
            </div>
          </div>
        </div>

        {/* Text descriptions and launch triggers */}
        <div className="flex-1 space-y-2 text-center md:text-left z-10">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-[9px] font-bold uppercase tracking-wider">
            ✨ Interactive Design Lab
          </span>
          <h3 className="text-sm font-black text-gray-800 uppercase tracking-tight">WordPress-style Visual Builder</h3>
          <p className="text-xs text-gray-400 leading-relaxed font-medium">
            Customize typography pairings, brand colors, cover images, crop focuses, element visibilities, and CTA buttons inside a fully responsive distraction-free canvas.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-gray-900 hover:bg-black hover:scale-[1.02] active:scale-95 transition-all shadow-md flex items-center gap-2 mx-auto md:mx-0"
            >
              <span>🎨</span> Open Live Visual Customizer
            </button>
          </div>
        </div>
      </div>

      {/* ── DISSOCIATED FULLSCREEN IFRAME OVERLAY ───────────────── */}
      {isOpen && (
        <VisualCustomizer
          settings={settings}
          onChange={onChange}
          logoUrl={logoUrl}
          coverUrl={coverUrl}
          restaurantName={restaurantName}
          description={description}
          primaryColor={primaryColor}
          accentColor={accentColor}
          onClose={() => setIsOpen(false)}
          onSave={onSave}
          saving={saving}
          slug={slug}
        />
      )}
    </div>
  );
}
