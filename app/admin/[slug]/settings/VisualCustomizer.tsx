"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { HeroSettings } from "@/lib/hero-settings";

interface Props {
  settings: HeroSettings;
  onChange: (s: HeroSettings) => void;
  logoUrl: string;
  coverUrl: string;
  coverVideoUrl?: string;
  restaurantName: string;
  description: string;
  primaryColor: string;
  accentColor: string;
  onClose: () => void;
  onSave?: () => Promise<void>;
  saving?: boolean;
  slug?: string;
  menuItems?: any[];
}

type TabKey = "branding" | "cover" | "typography" | "cta" | "elements" | "navbar" | "partners" | "menu";
type ViewportMode = "desktop" | "tablet" | "mobile";

export default function VisualCustomizer({
  settings,
  onChange,
  logoUrl,
  coverUrl,
  coverVideoUrl,
  restaurantName,
  description,
  primaryColor,
  accentColor,
  onClose,
  onSave,
  saving = false,
  slug,
  menuItems = [],
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("branding");
  const [viewport, setViewport] = useState<ViewportMode>("mobile");
  const [saveSuccess, setSaveSuccess] = useState(false);

  const focalRef = useRef<HTMLDivElement>(null);
  const logoFocalRef = useRef<HTMLDivElement>(null);
  const previewScrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto scroll preview section into view when activeTab changes
  useEffect(() => {
    if (!previewScrollContainerRef.current) return;
    let targetId = "";
    if (activeTab === "cover" || activeTab === "branding" || activeTab === "cta" || activeTab === "typography") {
      targetId = "mockup-hero-section";
    } else if (activeTab === "navbar") {
      targetId = "mockup-navbar-section";
    } else if (activeTab === "partners") {
      targetId = "mockup-partners-section";
    } else if (activeTab === "menu") {
      targetId = "mockup-menu-section";
    }

    if (targetId) {
      const targetElement = previewScrollContainerRef.current.querySelector(`#${targetId}`);
      if (targetElement) {
        setTimeout(() => {
          targetElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 120);
      }
    }
  }, [activeTab]);

  // Auto-inject Google Fonts for typography previews
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&family=Outfit:wght@400;600;800;900&family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Inter:wght@400;500;700&display=swap";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  const set = <K extends keyof HeroSettings>(k: K, v: HeroSettings[K]) =>
    onChange({ ...settings, [k]: v });

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

  const toggleTab = (tab: TabKey) => {
    setActiveTab((prev) => (prev === tab ? tab : tab));
  };

  // Font styling resolver
  const getTypographyStyles = () => {
    switch (settings.fontPairing) {
      case "modern-serif":
        return {
          heading: { fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 900 },
          sub: { fontFamily: "'Inter', sans-serif", fontWeight: 400 },
        };
      case "sleek-sans":
        return {
          heading: { fontFamily: "'Outfit', sans-serif", fontWeight: 900 },
          sub: { fontFamily: "'Outfit', sans-serif", fontWeight: 400 },
        };
      case "warm-display":
        return {
          heading: { fontFamily: "'Montserrat', sans-serif", fontWeight: 900 },
          sub: { fontFamily: "'Outfit', sans-serif", fontWeight: 400 },
        };
      default:
        return {
          heading: { fontFamily: "system-ui, sans-serif", fontWeight: 800 },
          sub: { fontFamily: "system-ui, sans-serif", fontWeight: 500 },
        };
    }
  };

  // Overlay styles resolver
  const getOverlayStyle = () => {
    const opacity = (settings.overlayOpacity / 100).toFixed(2);
    const blendMode = settings.overlayBlendMode || "normal";

    const styles: React.CSSProperties = {
      mixBlendMode: blendMode,
    };

    switch (settings.overlayType) {
      case "solid-brand":
        return {
          ...styles,
          background: `rgba(${hexToRgb(primaryColor)}, ${opacity})`,
        };
      case "gradient-brand":
        return {
          ...styles,
          background: `linear-gradient(to top, rgba(${hexToRgb(primaryColor)}, ${opacity}) 0%, rgba(0,0,0,${(settings.overlayOpacity * 0.5 / 100).toFixed(2)}) 80%, rgba(0,0,0,${(settings.overlayOpacity * 0.2 / 100).toFixed(2)}) 100%)`,
        };
      case "custom-solid":
        const customColor = settings.overlayCustomColor || "#000000";
        return {
          ...styles,
          background: `rgba(${hexToRgb(customColor)}, ${opacity})`,
        };
      case "custom-gradient":
        const gradStart = settings.overlayCustomColor || "#000000";
        const gradEnd = settings.overlayGradientColorEnd || "#000000";
        return {
          ...styles,
          background: `linear-gradient(to top, rgba(${hexToRgb(gradStart)}, ${opacity}) 0%, rgba(${hexToRgb(gradEnd)}, ${opacity}) 100%)`,
        };
      case "none":
        return { ...styles, background: "none" };
      default:
        return {
          ...styles,
          background: `linear-gradient(to top, rgba(0,0,0,${opacity}) 0%, rgba(0,0,0,${(settings.overlayOpacity * 0.47 / 100).toFixed(2)}) 50%, rgba(0,0,0,${(settings.overlayOpacity * 0.12 / 100).toFixed(2)}) 100%)`,
        };
    }
  };

  // Helper to convert hex to comma-separated RGB
  function hexToRgb(hex: string) {
    let clean = hex.replace("#", "");
    if (clean.length === 3) {
      clean = clean.split("").map((c) => c + c).join("");
    }
    const bigint = parseInt(clean, 16) || 0;
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
  }

  const fonts = getTypographyStyles();
  const overlayStyle = getOverlayStyle();
  const justifyClass =
    settings.textVerticalPosition === "top"
      ? "justify-start"
      : settings.textVerticalPosition === "middle"
      ? "justify-center"
      : "justify-end";

  // Dynamic CSS variables inside live frame
  const brandStyle = {
    "--brand-primary": primaryColor,
    "--brand-accent": accentColor,
    "--brand-primary-10": `${primaryColor}1a`,
    "--brand-primary-20": `${primaryColor}33`,
  } as React.CSSProperties;

  const getNavbarPreviewStyle = () => {
    switch (settings.navbarBgStyle) {
      case "solid-brand":
        return {
          background: primaryColor,
          color: "#ffffff",
        };
      case "glass-blur":
        return {
          background: "rgba(255, 255, 255, 0.75)",
          backdropFilter: "blur(12px)",
          color: "#1c1917",
          borderBottom: "1px solid rgba(0, 0, 0, 0.05)",
        };
      case "dark-tint":
        return {
          background: "rgba(15, 15, 15, 0.85)",
          backdropFilter: "blur(8px)",
          color: "#ffffff",
          borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        };
      default: // transparent
        return {
          background: "linear-gradient(to bottom, rgba(0, 0, 0, 0.45), transparent)",
          color: "#ffffff",
        };
    }
  };
  const navPreviewStyle = getNavbarPreviewStyle();
  const isLightNav = settings.navbarBgStyle === "glass-blur";

  return (
    <div className="fixed inset-0 z-[9999] bg-[#FAF9F5] flex flex-col font-sans select-none overflow-hidden text-neutral-800 antialiased">
      {/* ── HEADER ──────────────────────────────────────────────── */}
      <header className="h-16 border-b border-[#EFECE6] bg-white px-6 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
            <span className="text-lg">🎨</span>
          </div>
          <div>
            <h1 className="text-sm font-black tracking-tight text-neutral-900">RestoFlow Live Customizer</h1>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Real-time design engine</p>
          </div>
        </div>

        {/* Viewport switch controls */}
        <div className="flex items-center gap-1 bg-[#FAF9F5] border border-[#EFECE6] rounded-xl p-1 shadow-inner">
          <button
            onClick={() => setViewport("desktop")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              viewport === "desktop" ? "bg-white text-gray-900 shadow" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <span>🖥️</span> Desktop
          </button>
          <button
            onClick={() => setViewport("tablet")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              viewport === "tablet" ? "bg-white text-gray-900 shadow" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <span>📟</span> Tablet
          </button>
          <button
            onClick={() => setViewport("mobile")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              viewport === "mobile" ? "bg-white text-gray-900 shadow" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <span>📱</span> Mobile
          </button>
        </div>

        {/* Header Action Controls */}
        <div className="flex items-center gap-2">
          {/* Live Storefront Preview */}
          <button
            onClick={() => {
              if (slug) {
                window.open(`/admin/${slug}/preview`, "_blank");
              } else {
                alert("Storefront URL is currently initializing.");
              }
            }}
            className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-orange-600 bg-orange-50 border border-orange-200 hover:bg-orange-100/50 active:scale-95 transition shadow-xs flex items-center gap-1.5"
          >
            <span>👁️</span> Live Preview
          </button>

          {/* Save Changes Button */}
          <button
            disabled={saving}
            onClick={async () => {
              if (onSave) {
                try {
                  await onSave();
                  setSaveSuccess(true);
                  setTimeout(() => setSaveSuccess(false), 2500);
                } catch {
                  // error handled
                }
              }
            }}
            className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-white transition flex items-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
              saveSuccess ? "bg-emerald-600 hover:bg-emerald-700" : "bg-neutral-900 hover:bg-neutral-800"
            }`}
          >
            {saving ? (
              <>
                <svg className="animate-spin h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Saving...</span>
              </>
            ) : saveSuccess ? (
              <>
                <span>✓</span> Saved!
              </>
            ) : (
              <>
                <span>💾</span> Save Changes
              </>
            )}
          </button>

          {/* Close / Exit Button */}
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-gray-700 bg-white border border-[#EFECE6] hover:bg-stone-50 active:scale-95 transition shadow-xs"
          >
            Exit
          </button>
        </div>
      </header>

      {/* ── WORKSPACE CORE ──────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left side editor panel */}
        <aside className="w-[390px] border-r border-[#EFECE6] bg-white flex flex-col h-full z-10 shadow-[2px_0_15px_rgba(0,0,0,0.01)]">
          <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
            
            {/* 1. Branding & Logo */}
            <AccordionItem
              title="Branding & Logo"
              icon="🏢"
              active={activeTab === "branding"}
              onClick={() => toggleTab("branding")}
            >
              <div className="space-y-4">
                <div className="flex items-center gap-4 bg-stone-50 p-3 rounded-2xl border border-gray-100">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="logo"
                      className="w-12 h-12 rounded-xl border object-cover shadow-sm bg-white"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-gray-200 border-2 border-dashed flex items-center justify-center text-[10px] font-bold text-gray-400">
                      No Logo
                    </div>
                  )}
                  <div>
                    <h3 className="text-xs font-black text-gray-700 uppercase tracking-wider">Logo Dimensions</h3>
                    <p className="text-[10px] text-gray-400 mt-0.5">Scale and fit inside the header strip</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Slider label="Width" min={24} max={120} value={settings.logoWidth} onChange={(v) => set("logoWidth", v)} suffix="px" />
                  <Slider label="Height" min={24} max={120} value={settings.logoHeight} onChange={(v) => set("logoHeight", v)} suffix="px" />
                </div>
                <Slider label="Corner Radius" min={0} max={60} value={settings.logoBorderRadius} onChange={(v) => set("logoBorderRadius", v)} suffix="px" />
                
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Image Alignment Fit</label>
                  <ToggleGroup
                    options={[
                      { value: "cover", label: "Fill & Crop" },
                      { value: "contain", label: "Show Full Logo" },
                    ]}
                    value={settings.logoObjectFit}
                    onChange={(v) => set("logoObjectFit", v as "cover" | "contain")}
                  />
                </div>

                {logoUrl && settings.logoObjectFit === "cover" && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Logo Crop Focus <span className="text-orange-500 font-bold lowercase">(click to lock)</span>
                    </label>
                    <div
                      ref={logoFocalRef}
                      onClick={handleLogoFocalClick}
                      className="relative rounded-2xl overflow-hidden cursor-crosshair border border-gray-150 select-none shadow-sm"
                      style={{ height: 80 }}
                    >
                      <img src={logoUrl} alt="" className="w-full h-full object-cover" />
                      <div
                        className="absolute w-5 h-5 rounded-full border-2 border-white shadow bg-orange-500 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                        style={{ left: `${settings.logoFocalX}%`, top: `${settings.logoFocalY}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </AccordionItem>

            {/* 2. Cover & Layout */}
            <AccordionItem
              title="Cover & Layout"
              icon="🖼️"
              active={activeTab === "cover"}
              onClick={() => toggleTab("cover")}
            >
              <div className="space-y-4">
                <Slider label="Hero Height" min={30} max={100} value={settings.heroHeight} onChange={(v) => set("heroHeight", v)} suffix="vh" />
                
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Image Fit Mode</label>
                  <ToggleGroup
                    options={[
                      { value: "cover", label: "Fill & Zoom" },
                      { value: "contain", label: "Show Whole Banner" },
                    ]}
                    value={settings.coverObjectFit}
                    onChange={(v) => set("coverObjectFit", v as "cover" | "contain")}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Overlay Type</label>
                  <ToggleGroup
                    options={[
                      { value: "dark", label: "Classic Dark" },
                      { value: "solid-brand", label: "Solid Brand" },
                      { value: "gradient-brand", label: "Brand Gradient" },
                      { value: "custom-solid", label: "Custom Solid" },
                      { value: "custom-gradient", label: "Custom Gradient" },
                      { value: "none", label: "None" },
                    ]}
                    value={settings.overlayType}
                    onChange={(v) => set("overlayType", v as any)}
                  />
                </div>

                {/* Custom solid overlay color input */}
                {(settings.overlayType === "custom-solid" || settings.overlayType === "custom-gradient") && (
                  <div className="space-y-3 pt-1">
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                        {settings.overlayType === "custom-gradient" ? "Overlay Gradient Start" : "Overlay Color"}
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={settings.overlayCustomColor || "#000000"}
                          onChange={(e) => set("overlayCustomColor", e.target.value)}
                          className="w-10 h-8 rounded-lg cursor-pointer border border-gray-200"
                        />
                        <input
                          type="text"
                          value={settings.overlayCustomColor || "#000000"}
                          onChange={(e) => set("overlayCustomColor", e.target.value)}
                          className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Custom gradient overlay end color input */}
                {settings.overlayType === "custom-gradient" && (
                  <div className="space-y-3 pt-1">
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                        Overlay Gradient End
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={settings.overlayGradientColorEnd || "#000000"}
                          onChange={(e) => set("overlayGradientColorEnd", e.target.value)}
                          className="w-10 h-8 rounded-lg cursor-pointer border border-gray-200"
                        />
                        <input
                          type="text"
                          value={settings.overlayGradientColorEnd || "#000000"}
                          onChange={(e) => set("overlayGradientColorEnd", e.target.value)}
                          className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Blend Mode selector */}
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Overlay Blend Mode</label>
                  <select
                    value={settings.overlayBlendMode || "normal"}
                    onChange={(e) => set("overlayBlendMode", e.target.value as any)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                  >
                    <option value="normal">Normal (Standard)</option>
                    <option value="multiply">Multiply (Rich shadows)</option>
                    <option value="screen">Screen (Light blend)</option>
                    <option value="overlay">Overlay (High contrast)</option>
                    <option value="darken">Darken</option>
                    <option value="lighten">Lighten</option>
                  </select>
                </div>

                <Slider label="Overlay Opacity" min={0} max={100} value={settings.overlayOpacity} onChange={(v) => set("overlayOpacity", v)} suffix="%" />

                {coverUrl && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                      Cover Banner Focus <span className="text-orange-500 font-bold lowercase">(click to lock)</span>
                    </label>
                    <div
                      ref={focalRef}
                      onClick={handleFocalClick}
                      className="relative rounded-2xl overflow-hidden cursor-crosshair border border-gray-150 select-none shadow-sm"
                      style={{ height: 120 }}
                    >
                      <img src={coverUrl} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/15 pointer-events-none" />
                      <div
                        className="absolute w-6 h-6 rounded-full border-2 border-white shadow-lg bg-orange-500 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                        style={{ left: `${settings.focalPointX}%`, top: `${settings.focalPointY}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </AccordionItem>

            {/* 3. Typography */}
            <AccordionItem
              title="Typography"
              icon="🔤"
              active={activeTab === "typography"}
              onClick={() => toggleTab("typography")}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Typography Font Pairing</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: "default", name: "System Serif", desc: "Default clean style" },
                      { key: "modern-serif", name: "Playfair Display", desc: "Elegant high-end foodie" },
                      { key: "sleek-sans", name: "Outfit Sans", desc: "Minimal premium brand" },
                      { key: "warm-display", name: "Montserrat Display", desc: "Bold friendly vibe" },
                    ].map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => set("fontPairing", f.key as any)}
                        className={`p-2.5 rounded-xl border text-left transition ${
                          settings.fontPairing === f.key
                            ? "border-orange-500 bg-orange-50/50"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                      >
                        <h4 className="text-xs font-bold text-gray-900 leading-tight">{f.name}</h4>
                        <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">{f.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Alignment & Grid Layout</label>
                    <div className="grid grid-cols-3 gap-1.5 w-fit">
                      {(["top", "middle", "bottom"] as const).map((v) =>
                        (["left", "center", "right"] as const).map((a) => {
                          const active = settings.textVerticalPosition === v && settings.textAlign === a;
                          return (
                            <button
                              key={`${v}-${a}`}
                              type="button"
                              onClick={() => onChange({ ...settings, textVerticalPosition: v, textAlign: a })}
                              className={`w-10 h-10 rounded-xl border transition flex items-center justify-center ${
                                active ? "border-orange-500 bg-orange-50" : "border-gray-200 bg-white hover:border-gray-350"
                              }`}
                            >
                              <PosDot active={active} v={v} a={a} />
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <Slider label="Heading Font Size" min={20} max={80} value={settings.headingSize} onChange={(v) => set("headingSize", v)} suffix="px" />
                  <Slider label="Subtitle Font Size" min={10} max={32} value={settings.subtitleSize} onChange={(v) => set("subtitleSize", v)} suffix="px" />
                  <Slider label="Line Height" min={80} max={250} value={settings.lineHeight} onChange={(v) => set("lineHeight", v)} div={100} suffix="" />
                  <Slider label="Letter Spacing" min={-8} max={25} value={settings.letterSpacing} onChange={(v) => set("letterSpacing", v)} div={100} suffix="em" />
                </div>
              </div>
            </AccordionItem>

            {/* 4. Buttons & CTA */}
            <AccordionItem
              title="CTA Buttons"
              icon="🔘"
              active={activeTab === "cta"}
              onClick={() => toggleTab("cta")}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Button Edge Style</label>
                  <ToggleGroup
                    options={[
                      { value: "pill", label: "Pill Shape" },
                      { value: "rounded", label: "Rounded" },
                      { value: "sharp", label: "Sharp Box" },
                    ]}
                    value={settings.buttonStyle}
                    onChange={(v) => set("buttonStyle", v as any)}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Primary CTA Button Label</label>
                  <input
                    type="text"
                    value={settings.primaryCtaText}
                    onChange={(e) => set("primaryCtaText", e.target.value)}
                    placeholder="e.g. Order Online"
                    className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                  />
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <label className="flex items-center gap-3 cursor-pointer w-fit">
                    <div
                      onClick={() => set("showSecondaryCta", !settings.showSecondaryCta)}
                      className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${settings.showSecondaryCta ? "bg-orange-500" : "bg-gray-200"}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.showSecondaryCta ? "translate-x-4" : "translate-x-0.5"}`} />
                    </div>
                    <span className="text-xs font-bold text-gray-700">Display Secondary CTA Button</span>
                  </label>
                </div>

                {settings.showSecondaryCta && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Secondary CTA Button Label</label>
                    <input
                      type="text"
                      value={settings.secondaryCtaText}
                      onChange={(e) => set("secondaryCtaText", e.target.value)}
                      placeholder="e.g. Book a Table"
                      className="w-full border border-gray-255 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                    />
                  </div>
                )}
              </div>
            </AccordionItem>

            {/* 5. Navigation Bar Customizer */}
            <AccordionItem
              title="Navigation Bar"
              icon="🧭"
              active={activeTab === "navbar"}
              onClick={() => toggleTab("navbar")}
            >
              <div className="space-y-4">
                <ToggleRow
                  label="Sticky Floating Navbar"
                  enabled={settings.navbarSticky}
                  onToggle={() => set("navbarSticky", !settings.navbarSticky)}
                />
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Navbar Fills & Fades</label>
                  <ToggleGroup
                    options={[
                      { value: "transparent", label: "Transparent" },
                      { value: "glass-blur", label: "Frosted Glass" },
                      { value: "solid-brand", label: "Solid Brand" },
                      { value: "dark-tint", label: "Dark Tint" },
                    ]}
                    value={settings.navbarBgStyle}
                    onChange={(v) => set("navbarBgStyle", v as any)}
                  />
                </div>
                
                <Slider label="Menu Font Size" min={9} max={20} value={settings.navbarFontSize} onChange={(v) => set("navbarFontSize", v)} suffix="px" />

                <div className="border-t border-gray-100 pt-3 space-y-3.5">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Navigation Labels</label>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-450 uppercase mb-1">Menu Link Label</label>
                    <input
                      type="text"
                      value={settings.navbarMenuTextMenu}
                      onChange={(e) => set("navbarMenuTextMenu", e.target.value)}
                      placeholder="e.g. Menu"
                      className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-450 uppercase mb-1">Reviews Link Label</label>
                    <input
                      type="text"
                      value={settings.navbarMenuTextReviews}
                      onChange={(e) => set("navbarMenuTextReviews", e.target.value)}
                      placeholder="e.g. Reviews"
                      className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-450 uppercase mb-1">Info Link Label</label>
                    <input
                      type="text"
                      value={settings.navbarMenuTextInfo}
                      onChange={(e) => set("navbarMenuTextInfo", e.target.value)}
                      placeholder="e.g. Info"
                      className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                    />
                  </div>
                </div>
              </div>
            </AccordionItem>

            {/* 6. Visibility Toggles */}
            <AccordionItem
              title="Visibility Toggles"
              icon="👁️"
              active={activeTab === "elements"}
              onClick={() => toggleTab("elements")}
            >
              <div className="space-y-3 pt-1">
                <ToggleRow label="Show Brand Logo" enabled={settings.showLogo} onToggle={() => set("showLogo", !settings.showLogo)} />
                <ToggleRow label="Show Subtitle / Description" enabled={settings.showSubtitle} onToggle={() => set("showSubtitle", !settings.showSubtitle)} />
                <ToggleRow label="Show Cuisine & Metric Tags" enabled={settings.showTags} onToggle={() => set("showTags", !settings.showTags)} />
                <ToggleRow label="Show Open Status Badge" enabled={settings.showOpenBadge} onToggle={() => set("showOpenBadge", !settings.showOpenBadge)} />
              </div>
            </AccordionItem>

            {/* 7. Partner Showcase */}
            <AccordionItem
              title="Partner Showcase"
              icon="🏢"
              active={activeTab === "partners"}
              onClick={() => toggleTab("partners")}
            >
              <div className="space-y-4 pt-1">
                <ToggleRow
                  label="Display Partner Showcase"
                  enabled={settings.showPartnersSection}
                  onToggle={() => set("showPartnersSection", !settings.showPartnersSection)}
                />
                
                {settings.showPartnersSection && (
                  <>
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Showcase Style</label>
                      <ToggleGroup
                        options={[
                          { value: "floating", label: "Floating Marquee" },
                          { value: "stagnant", label: "Stagnant Grid" },
                        ]}
                        value={settings.partnersStyle}
                        onChange={(v) => set("partnersStyle", v as any)}
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Showcase Section Title</label>
                      <input
                        type="text"
                        value={settings.partnersSectionTitle}
                        onChange={(e) => set("partnersSectionTitle", e.target.value)}
                        placeholder="e.g. Trusted Partners"
                        className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                      />
                    </div>
                  </>
                )}
              </div>
            </AccordionItem>

            {/* 8. Culinary Menu Customizer */}
            <AccordionItem
              title="Storefront Menu"
              icon="🍽️"
              active={activeTab === "menu"}
              onClick={() => toggleTab("menu")}
            >
              <div className="space-y-4 pt-1">
                {/* 1. Header label visibility & text */}
                <div className="space-y-2">
                  <ToggleRow
                    label="Show Subheader Label"
                    enabled={settings.menuShowHeaderLabel !== false}
                    onToggle={() => set("menuShowHeaderLabel", settings.menuShowHeaderLabel === false ? true : false)}
                  />
                  {(settings.menuShowHeaderLabel !== false) && (
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Subheader text</label>
                      <input
                        type="text"
                        value={settings.menuHeaderLabelText || ""}
                        onChange={(e) => set("menuHeaderLabelText", e.target.value)}
                        placeholder="e.g. Elite Gastronomy"
                        className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                      />
                    </div>
                  )}
                </div>

                {/* 2. Main Title Text */}
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Menu Title</label>
                  <input
                    type="text"
                    value={settings.menuTitleText || ""}
                    onChange={(e) => set("menuTitleText", e.target.value)}
                    placeholder="Explore Culinary Menu"
                    className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium"
                  />
                </div>

                {/* 3. Description visibility & text */}
                <div className="space-y-2">
                  <ToggleRow
                    label="Show Menu Description"
                    enabled={settings.menuShowDescription !== false}
                    onToggle={() => set("menuShowDescription", settings.menuShowDescription === false ? true : false)}
                  />
                  {(settings.menuShowDescription !== false) && (
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Description Paragraph</label>
                      <textarea
                        value={settings.menuDescriptionText || ""}
                        onChange={(e) => set("menuDescriptionText", e.target.value)}
                        placeholder="Freshly made dishes, sides, desserts..."
                        rows={3}
                        className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 transition bg-white font-medium resize-none"
                      />
                    </div>
                  )}
                </div>

                <hr className="border-gray-100" />

                {/* 4. Typography Sizing Sliders */}
                <div className="space-y-3">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Typography Sizing</label>
                  
                  {settings.menuShowHeaderLabel !== false && (
                    <div>
                      <div className="flex justify-between text-[10px] text-gray-500 font-bold mb-1">
                        <span>Subheader Label size</span>
                        <span>{settings.menuLabelSize || 10}px</span>
                      </div>
                      <input
                        type="range"
                        min="8"
                        max="16"
                        value={settings.menuLabelSize || 10}
                        onChange={(e) => set("menuLabelSize", parseInt(e.target.value))}
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between text-[10px] text-gray-500 font-bold mb-1">
                      <span>Menu Title size</span>
                      <span>{settings.menuTitleSize || 30}px</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="60"
                      value={settings.menuTitleSize || 30}
                      onChange={(e) => set("menuTitleSize", parseInt(e.target.value))}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    />
                  </div>

                  {settings.menuShowDescription !== false && (
                    <div>
                      <div className="flex justify-between text-[10px] text-gray-500 font-bold mb-1">
                        <span>Description size</span>
                        <span>{settings.menuDescriptionSize || 14}px</span>
                      </div>
                      <input
                        type="range"
                        min="11"
                        max="18"
                        value={settings.menuDescriptionSize || 14}
                        onChange={(e) => set("menuDescriptionSize", parseInt(e.target.value))}
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
                      />
                    </div>
                  )}
                </div>

                <hr className="border-gray-100" />

                {/* 5. Section Background styling */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Section Background</label>
                    <ToggleGroup
                      options={[
                        { value: "default", label: "Default" },
                        { value: "solid", label: "Solid Color" },
                        { value: "gradient", label: "Gradient" },
                      ]}
                      value={settings.menuBgColorType || "default"}
                      onChange={(v) => set("menuBgColorType", v as any)}
                    />
                  </div>

                  {settings.menuBgColorType === "solid" && (
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Custom Background Color</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={settings.menuCustomBgColor || "#ffffff"}
                          onChange={(e) => set("menuCustomBgColor", e.target.value)}
                          className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer p-0 overflow-hidden"
                        />
                        <input
                          type="text"
                          value={settings.menuCustomBgColor || ""}
                          onChange={(e) => set("menuCustomBgColor", e.target.value)}
                          placeholder="#ffffff"
                          className="flex-1 border border-gray-250 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-orange-500 bg-white"
                        />
                      </div>
                    </div>
                  )}

                  {settings.menuBgColorType === "gradient" && (
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Linear Gradient Rule</label>
                      <input
                        type="text"
                        value={settings.menuCustomGradient || ""}
                        onChange={(e) => set("menuCustomGradient", e.target.value)}
                        placeholder="e.g. linear-gradient(135deg, #fdfbf7 0%, #ffffff 100%)"
                        className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 bg-white font-mono"
                      />
                    </div>
                  )}
                </div>

                <hr className="border-gray-100" />

                {/* 6. Card Columns & Layout sizing */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Card Grid Columns</label>
                    <ToggleGroup
                      options={[
                        { value: "1", label: "1 Col" },
                        { value: "2", label: "2 Cols" },
                        { value: "3", label: "3 Cols" },
                        { value: "4", label: "4 Cols" },
                        { value: "5", label: "5 Cols" },
                      ]}
                      value={String(settings.menuColumns || 3)}
                      onChange={(v) => set("menuColumns", parseInt(v) as any)}
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-gray-500 font-bold mb-1">
                      <span>Card Rounding (Border Radius)</span>
                      <span>{settings.menuCardBorderRadius ?? 16}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="32"
                      value={settings.menuCardBorderRadius ?? 16}
                      onChange={(e) => set("menuCardBorderRadius", parseInt(e.target.value))}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-gray-500 font-bold mb-1">
                      <span>Card Image Height</span>
                      <span>{settings.menuCardImageHeight || 180}px</span>
                    </div>
                    <input
                      type="range"
                      min="120"
                      max="300"
                      value={settings.menuCardImageHeight || 180}
                      onChange={(e) => set("menuCardImageHeight", parseInt(e.target.value))}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Image Fit / Scale (Crop)</label>
                    <ToggleGroup
                      options={[
                        { value: "cover", label: "Crop Fill (Cover)" },
                        { value: "contain", label: "Fit Screen (Contain)" },
                      ]}
                      value={settings.menuCardImageFit || "cover"}
                      onChange={(v) => set("menuCardImageFit", v as any)}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Card Text Alignment</label>
                    <ToggleGroup
                      options={[
                        { value: "left", label: "Left" },
                        { value: "center", label: "Center" },
                        { value: "right", label: "Right" },
                      ]}
                      value={settings.menuCardTextAlign || "left"}
                      onChange={(v) => set("menuCardTextAlign", v as any)}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Card Background Styling</label>
                    <ToggleGroup
                      options={[
                        { value: "default", label: "Card Default" },
                        { value: "transparent", label: "Transparent" },
                        { value: "custom", label: "Custom Solid" },
                      ]}
                      value={settings.menuCardBgStyle || "default"}
                      onChange={(v) => set("menuCardBgStyle", v as any)}
                    />
                  </div>

                  {settings.menuCardBgStyle === "custom" && (
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Custom Card Bg Color</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={settings.menuCardCustomBgColor || "#ffffff"}
                          onChange={(e) => set("menuCardCustomBgColor", e.target.value)}
                          className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer p-0 overflow-hidden"
                        />
                        <input
                          type="text"
                          value={settings.menuCardCustomBgColor || ""}
                          onChange={(e) => set("menuCardCustomBgColor", e.target.value)}
                          placeholder="#ffffff"
                          className="flex-1 border border-gray-250 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-orange-500 bg-white"
                        />
                      </div>
                    </div>
                  )}

                  {/* Card Highlight Badge Visibility & Custom Text */}
                  <div className="pt-1.5 border-t border-dashed border-gray-150 space-y-3">
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Show Highlight Badge</label>
                      <ToggleGroup
                        options={[
                          { value: "true", label: "Visible" },
                          { value: "false", label: "Hidden" },
                        ]}
                        value={String(settings.menuShowBadge !== false)}
                        onChange={(v) => set("menuShowBadge", v === "true")}
                      />
                    </div>

                    {settings.menuShowBadge !== false && (
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Badge Text</label>
                        <input
                          type="text"
                          value={settings.menuBadgeText || "Popular"}
                          onChange={(e) => set("menuBadgeText", e.target.value)}
                          placeholder="e.g. Popular, Chef's Special, Elite"
                          className="w-full border border-gray-250 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500 bg-white font-medium"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </AccordionItem>

          </div>
        </aside>

        {/* Right side live interactive mockup pane */}
        <main className="flex-1 bg-[#FAF9F5] p-8 flex items-center justify-center overflow-y-auto z-0 relative select-text">
          {/* Parallax background canvas helper */}
          <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none" />

          {/* VIEWPORT CONTROLLER CONTAINER */}
          <div
            className={`transition-all duration-300 ease-out flex flex-col ${
              viewport === "desktop"
                ? "w-full max-w-6xl"
                : viewport === "tablet"
                ? "w-[768px]"
                : "w-[390px] border-[10px] border-neutral-900 rounded-[50px] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] bg-[#0d0c0b] overflow-hidden relative"
            }`}
            style={{
              height: viewport === "mobile" ? "680px" : undefined,
            }}
          >
            {/* Viewport Dynamic Island notch mockup */}
            {viewport === "mobile" && (
              <div className="h-6 w-full bg-neutral-900 flex items-center justify-center flex-shrink-0 z-50">
                <div className="w-24 h-4 bg-black rounded-full shadow-inner mt-1" />
              </div>
            )}

            {/* PREVIEW CONTAINER */}
            <div
              ref={previewScrollContainerRef}
              style={brandStyle}
              className={`w-full select-none bg-stone-100 flex flex-col relative transition-colors scroll-smooth ${
                viewport === "mobile" 
                  ? "flex-1 overflow-y-auto scrollbar-hide" 
                  : "rounded-3xl border border-[#EFECE6] shadow-xl h-[600px] overflow-y-auto scrollbar-hide"
              }`}
            >
              {/* Storefront Hero section inside mockup */}
              <section
                id="mockup-hero-section"
                onClick={() => toggleTab("cover")}
                className={`relative flex flex-col bg-stone-100 overflow-hidden cursor-pointer hover:ring-2 hover:ring-orange-500/50 transition-all ${justifyClass}`}
                style={{
                  height: viewport === "mobile" ? "100%" : "400px",
                  minHeight: viewport === "mobile" ? undefined : `${settings.heroHeight}vh`,
                }}
              >
                {coverVideoUrl ? (
                  <div className="absolute inset-0 z-0 pointer-events-none">
                    <video
                      src={coverVideoUrl}
                      poster={coverUrl}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0" style={overlayStyle} />
                  </div>
                ) : coverUrl && (
                  <div className="absolute inset-0 z-0 pointer-events-none">
                    <img
                      src={coverUrl}
                      alt=""
                      className="w-full h-full opacity-90 transition-transform duration-500 scale-100"
                      style={{
                        objectFit: settings.coverObjectFit,
                        objectPosition: `${settings.focalPointX}% ${settings.focalPointY}%`,
                      }}
                    />
                    <div className="absolute inset-0" style={overlayStyle} />
                  </div>
                )}

                {/* Navbar strip inside mockup */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTab("navbar");
                  }}
                  style={navPreviewStyle}
                  className="absolute top-0 left-0 right-0 z-20 py-4 cursor-pointer hover:bg-white/5 transition-all"
                >
                  <div className="max-w-6xl mx-auto w-full px-5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {settings.showLogo && logoUrl ? (
                        <div
                          className={`overflow-hidden flex-shrink-0 ${isLightNav ? "border border-stone-900/10 shadow-sm bg-white" : "border border-white/20 shadow"}`}
                          style={{
                            width: Math.round(settings.logoWidth * 0.7),
                            height: Math.round(settings.logoHeight * 0.7),
                            borderRadius: Math.round(settings.logoBorderRadius * 0.7),
                          }}
                        >
                          <img
                            src={logoUrl}
                            alt="logo"
                            className="w-full h-full"
                            style={{
                              objectFit: settings.logoObjectFit,
                              objectPosition: `${settings.logoFocalX}% ${settings.logoFocalY}%`,
                            }}
                          />
                        </div>
                      ) : settings.showLogo ? (
                        <div
                          className={`backdrop-blur flex items-center justify-center border flex-shrink-0 ${
                            isLightNav ? "bg-stone-900/10 border-stone-900/10 text-stone-850" : "bg-white/15 border-white/20 text-white"
                          }`}
                          style={{
                            width: Math.round(settings.logoWidth * 0.7),
                            height: Math.round(settings.logoHeight * 0.7),
                            borderRadius: Math.round(settings.logoBorderRadius * 0.7),
                          }}
                        >
                          <span className={`font-extrabold text-[9px] ${isLightNav ? "text-stone-800" : "text-white"}`}>
                            {restaurantName.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {/* Mockup Desktop/Tablet Menu Links */}
                    {viewport !== "mobile" && (
                      <div className="flex items-center gap-6">
                        {[
                          { label: settings.navbarMenuTextMenu || "Menu" },
                          { label: settings.navbarMenuTextReviews || "Reviews" },
                          { label: settings.navbarMenuTextInfo || "Info" },
                        ].map((link, idx) => (
                          <span
                            key={idx}
                            className={`uppercase tracking-widest font-black transition ${
                              isLightNav ? "text-stone-600 hover:text-stone-900" : "text-white/80 hover:text-white"
                            }`}
                            style={{
                              fontSize: `${Math.round(settings.navbarFontSize * 0.75)}px`,
                            }}
                          >
                            {link.label}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {settings.showOpenBadge && (
                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[8px] font-bold uppercase tracking-wider ${
                          isLightNav
                            ? "bg-emerald-50 border-emerald-250 text-emerald-600"
                            : "bg-emerald-500/25 border-emerald-400/30 text-emerald-400"
                        }`}>
                          <span className={`w-1 h-1 rounded-full ${isLightNav ? "bg-emerald-500" : "bg-emerald-400"}`} />
                          Open
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Hero text overlay mockup */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTab("typography");
                  }}
                  className="relative z-10 max-w-6xl mx-auto w-full px-5 text-white py-6"
                  style={{
                    textAlign: settings.textAlign,
                  }}
                >
                  <div
                    className={`space-y-2.5 ${
                      settings.textAlign === "center"
                        ? "max-w-2xl mx-auto"
                        : settings.textAlign === "right"
                        ? "max-w-2xl ml-auto"
                        : "max-w-2xl"
                    }`}
                  >
                    <h1
                      className="font-black drop-shadow"
                      style={{
                        ...fonts.heading,
                        fontSize: Math.round(settings.headingSize * 0.7),
                        lineHeight: settings.lineHeight / 100,
                        letterSpacing: `${settings.letterSpacing * 0.01}em`,
                      }}
                    >
                      {restaurantName}
                    </h1>

                    {settings.showSubtitle && description && (
                      <p
                        className="text-white/85 font-medium leading-relaxed"
                        style={{
                          ...fonts.sub,
                          fontSize: Math.round(settings.subtitleSize * 0.75),
                          lineHeight: settings.lineHeight / 100,
                          letterSpacing: `${settings.letterSpacing * 0.01}em`,
                        }}
                      >
                        {description}
                      </p>
                    )}

                    {/* Tags metrics preview inside frame */}
                    {settings.showTags && (
                      <div
                        className={`flex flex-wrap gap-1.5 pt-1.5 border-t border-white/10 ${
                          settings.textAlign === "center"
                            ? "justify-center"
                            : settings.textAlign === "right"
                            ? "justify-end"
                            : ""
                        }`}
                      >
                        <div className="flex items-center gap-1 text-[8px] text-white/80 font-bold bg-white/10 px-2 py-0.5 rounded-md border border-white/10">
                          <span>⭐</span> 4.8
                        </div>
                        <div className="flex items-center gap-1 text-[8px] text-white/80 font-bold bg-white/10 px-2 py-0.5 rounded-md border border-white/10">
                          <span>⏱️</span> 20–35 min
                        </div>
                        <div className="flex items-center gap-1 text-[8px] text-white/80 font-bold bg-white/10 px-2 py-0.5 rounded-md border border-white/10">
                          <span>🚚</span> Free
                        </div>
                      </div>
                    )}

                    {/* Interactive button CTA shapes mockup */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTab("cta");
                      }}
                      className={`flex gap-2 pt-2 ${
                        settings.textAlign === "center"
                          ? "justify-center"
                          : settings.textAlign === "right"
                          ? "justify-end"
                          : ""
                      }`}
                    >
                      <button
                        type="button"
                        style={{ backgroundColor: primaryColor }}
                        className={`text-white text-[9px] font-black uppercase tracking-wider py-2.5 px-4 shadow ${
                          settings.buttonStyle === "pill"
                            ? "rounded-full"
                            : settings.buttonStyle === "sharp"
                            ? "rounded-none"
                            : "rounded-xl"
                        }`}
                      >
                        {settings.primaryCtaText || "Order Online"}
                      </button>

                      {settings.showSecondaryCta && (
                        <button
                          type="button"
                          className={`text-white text-[9px] font-black uppercase tracking-wider py-2.5 px-4 bg-white/15 border border-white/15 backdrop-blur ${
                            settings.buttonStyle === "pill"
                              ? "rounded-full"
                              : settings.buttonStyle === "sharp"
                              ? "rounded-none"
                              : "rounded-xl"
                          }`}
                        >
                          {settings.secondaryCtaText || "Book a Table"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* Dynamic CSS styles for marquee animation inside mockup */}
              <style>{`
                @keyframes marqueeCustomizer {
                  0% { transform: translateX(0%); }
                  100% { transform: translateX(-50%); }
                }
                .animate-marquee-preview {
                  display: flex;
                  width: max-content;
                  animation: marqueeCustomizer 25s linear infinite;
                }
              `}</style>

              {/* Mockup Partner Brands Showcase Section */}
              {settings.showPartnersSection && (
                <div
                  id="mockup-partners-section"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTab("partners");
                  }}
                  className={`bg-white border-b border-stone-100 py-3 overflow-hidden cursor-pointer hover:bg-stone-50 transition-all ${
                    activeTab === "partners" ? "ring-2 ring-orange-500/50" : ""
                  }`}
                >
                  <div className="max-w-6xl mx-auto px-4">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest text-center mb-1.5">
                      {settings.partnersSectionTitle || "Our Partners"}
                    </p>
                    
                    {settings.partnersStyle === "floating" ? (
                      <div className="relative overflow-hidden w-full h-8 flex items-center">
                        <div className="flex gap-8 whitespace-nowrap animate-marquee-preview py-1">
                          {[
                            { name: "Grills Capitol", icon: "🔥" },
                            { name: "Sweet Treats", icon: "🍰" },
                            { name: "The Noodle Box", icon: "🍜" },
                            { name: "Burger Craft", icon: "🍔" },
                            { name: "Pasta & Co", icon: "🍝" },
                          ].map((partner, idx) => (
                            <span key={idx} className="inline-flex items-center gap-1.5 text-[9px] font-extrabold text-[#7A7368]">
                              <span className="w-5 h-5 rounded bg-stone-100 flex items-center justify-center text-xs shadow-inner">
                                {partner.icon}
                              </span>
                              {partner.name}
                            </span>
                          ))}
                          {/* Duplicate for infinite effect */}
                          {[
                            { name: "Grills Capitol", icon: "🔥" },
                            { name: "Sweet Treats", icon: "🍰" },
                            { name: "The Noodle Box", icon: "🍜" },
                            { name: "Burger Craft", icon: "🍔" },
                            { name: "Pasta & Co", icon: "🍝" },
                          ].map((partner, idx) => (
                            <span key={`dup-${idx}`} className="inline-flex items-center gap-1.5 text-[9px] font-extrabold text-[#7A7368]">
                              <span className="w-5 h-5 rounded bg-stone-100 flex items-center justify-center text-xs shadow-inner">
                                {partner.icon}
                              </span>
                              {partner.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap justify-center gap-3 py-1">
                        {[
                          { name: "Grills Capitol", icon: "🔥" },
                          { name: "Sweet Treats", icon: "🍰" },
                          { name: "The Noodle Box", icon: "🍜" },
                          { name: "Burger Craft", icon: "🍔" },
                          { name: "Pasta & Co", icon: "🍝" },
                        ].map((partner, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1.5 text-[9px] font-extrabold text-[#7A7368] bg-stone-50 border border-stone-100 px-2 py-0.5 rounded-lg shadow-sm">
                            <span>{partner.icon}</span>
                            {partner.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Mockup Storefront Menu Section */}
              <div
                id="mockup-menu-section"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTab("menu");
                }}
                style={{
                  background:
                    settings.menuBgColorType === "solid"
                      ? settings.menuCustomBgColor || "#ffffff"
                      : settings.menuBgColorType === "gradient"
                      ? settings.menuCustomGradient || "linear-gradient(135deg, #fdfbf7 0%, #ffffff 100%)"
                      : "#ffffff",
                }}
                className={`py-6 border-b border-stone-100 transition-all cursor-pointer hover:bg-stone-50/50 ${
                  activeTab === "menu" ? "ring-2 ring-orange-500/50" : ""
                }`}
              >
                <div className="max-w-6xl mx-auto px-4">
                  {/* Category Pills Navigation Mockup */}
                  <div className="flex gap-1.5 justify-center mb-6 overflow-x-auto pb-1 scrollbar-hide">
                    <span className="text-[9px] font-black uppercase bg-orange-500 text-white px-3 py-1.5 rounded-full shadow-sm">
                      All Specialties
                    </span>
                    <span className="text-[9px] font-black uppercase bg-stone-100 text-stone-600 px-3 py-1.5 rounded-full border border-stone-200">
                      Main Dishes
                    </span>
                    <span className="text-[9px] font-black uppercase bg-stone-100 text-stone-600 px-3 py-1.5 rounded-full border border-stone-200">
                      Desserts & Sides
                    </span>
                  </div>

                  {/* Header Sublabel */}
                  {settings.menuShowHeaderLabel !== false && (
                    <div
                      className={`mb-1 ${
                        settings.menuCardTextAlign === "center"
                          ? "text-center"
                          : settings.menuCardTextAlign === "right"
                          ? "text-end"
                          : ""
                      }`}
                    >
                      <span
                        style={{ fontSize: `${settings.menuLabelSize || 10}px` }}
                        className="font-black uppercase tracking-wider text-orange-500"
                      >
                        {settings.menuHeaderLabelText || "Elite Gastronomy"}
                      </span>
                    </div>
                  )}

                  {/* Main Title Heading */}
                  <div
                    className={`${
                      settings.menuCardTextAlign === "center"
                        ? "text-center"
                        : settings.menuCardTextAlign === "right"
                        ? "text-end"
                        : ""
                    }`}
                  >
                    <h3
                      style={{ fontSize: `${settings.menuTitleSize || 30}px` }}
                      className="font-black text-neutral-900 tracking-tight leading-none"
                    >
                      {settings.menuTitleText || "Explore Culinary Menu"}
                    </h3>
                  </div>

                  {/* Description Paragraph */}
                  {settings.menuShowDescription !== false && (
                    <p
                      style={{ fontSize: `${settings.menuDescriptionSize || 14}px` }}
                      className={`text-[#7A7368] mt-1.5 leading-relaxed max-w-xl ${
                        settings.menuCardTextAlign === "center"
                          ? "mx-auto text-center"
                          : settings.menuCardTextAlign === "right"
                          ? "ml-auto text-end"
                          : ""
                      }`}
                    >
                      {settings.menuDescriptionText ||
                        "Explore freshly made signature dishes, snacks, side selections, beverages, and desserts."}
                    </p>
                  )}

                  {/* Custom columns card grid */}
                  <div
                    className={`grid gap-3.5 mt-6 ${
                      settings.menuColumns === 1
                        ? "grid-cols-1"
                        : settings.menuColumns === 2
                        ? "grid-cols-2"
                        : settings.menuColumns === 3
                        ? "grid-cols-3"
                        : settings.menuColumns === 4
                        ? "grid-cols-4"
                        : "grid-cols-5"
                    }`}
                  >
                    {(menuItems && menuItems.length > 0
                      ? menuItems.slice(0, 2).map((item, idx) => ({
                          name: item.name,
                          price: `₦${Number(item.price).toLocaleString()}`,
                          desc: item.description || "Freshly made standard selection.",
                          icon: "🍛",
                          image: item.image || "https://images.unsplash.com/photo-1534483509719-3feaee7c30da?w=600&auto=format",
                        }))
                      : [
                          {
                            name: "Party Jollof Rice and Moi-moi",
                            price: "₦8,000",
                            desc: "Smoky, spiced Jollof rice paired with a rich, steamed Moi-moi.",
                            icon: "🍛",
                            image: "https://images.unsplash.com/photo-1534483509719-3feaee7c30da?w=600&auto=format",
                          },
                          {
                            name: "Flame Grilled Quarter Chicken",
                            price: "₦12,500",
                            desc: "Succulent chicken marinated in heritage spices, flame kissed and tender.",
                            icon: "🍗",
                            image: "https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=600&auto=format",
                          },
                        ]
                    ).map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          borderRadius: `${settings.menuCardBorderRadius ?? 16}px`,
                          backgroundColor:
                            settings.menuCardBgStyle === "custom"
                              ? settings.menuCardCustomBgColor || "#ffffff"
                              : settings.menuCardBgStyle === "transparent"
                              ? "transparent"
                              : "#ffffff",
                        }}
                        className={`overflow-hidden border border-stone-150 transition shadow-sm ${
                          settings.menuCardBgStyle === "transparent" ? "border-transparent shadow-none" : ""
                        }`}
                      >
                        {/* Mock Image container */}
                        <div
                          style={{
                            height: `${settings.menuCardImageHeight || 180}px`,
                            backgroundColor:
                              settings.menuCardImageFit === "contain"
                                ? settings.menuCardBgStyle === "custom"
                                  ? settings.menuCardCustomBgColor || "#ffffff"
                                  : "#ffffff"
                                : undefined,
                          }}
                          className="relative w-full bg-stone-100 flex items-center justify-center overflow-hidden transition-all duration-300"
                        >
                          <img
                            src={item.image}
                            alt={item.name}
                            style={{
                              objectFit: settings.menuCardImageFit || "cover",
                            }}
                            className="w-full h-full transition-transform duration-500 hover:scale-105"
                          />
                          {settings.menuShowBadge !== false && (
                            <span className="absolute top-2 left-2 bg-orange-500 text-white text-[8px] font-black uppercase px-2 py-0.5 rounded-full shadow-sm">
                              {settings.menuBadgeText || "Popular"}
                            </span>
                          )}
                        </div>

                        {/* Card details */}
                        <div
                          className={`p-3.5 ${
                            settings.menuCardTextAlign === "center"
                              ? "text-center"
                              : settings.menuCardTextAlign === "right"
                              ? "text-end"
                              : ""
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row justify-between items-start gap-1">
                            <h4 className="font-extrabold text-[11px] text-neutral-900 leading-tight">
                              {item.name}
                            </h4>
                            <span className="text-[10px] font-black text-orange-600 leading-none">
                              {item.price}
                            </span>
                          </div>
                          <p className="text-[9px] text-neutral-500 mt-1 leading-normal font-medium">
                            {item.desc}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>

            {/* Bottom device bezel mockup */}
            {viewport === "mobile" && (
              <div className="h-6 w-full bg-neutral-900 flex items-center justify-center flex-shrink-0 z-50">
                <div className="w-32 h-1 bg-white/30 rounded-full mb-1" />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ── COMPONENT UTILITIES ─────────────────────────────────── */

function AccordionItem({
  title,
  icon,
  active,
  onClick,
  children,
}: {
  title: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-[#EFECE6] bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.015)] overflow-hidden transition-all duration-300">
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center justify-between px-4 py-3.5 bg-stone-50 hover:bg-stone-100/50 transition text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm">{icon}</span>
          <span className="text-xs font-black text-gray-800 uppercase tracking-tight">{title}</span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${active ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`transition-all duration-300 ease-in-out ${
          active ? "max-h-[800px] border-t border-[#EFECE6] p-4 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        } overflow-hidden`}
      >
        {children}
      </div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
  div = 1,
  suffix = "",
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  div?: number;
  suffix?: string;
}) {
  const displayVal = (value / div).toFixed(div > 1 ? 2 : 0);
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{label}</p>
        <span className="text-[10px] font-bold text-gray-400 bg-stone-100 px-1.5 py-0.5 rounded">
          {displayVal}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-orange-500 cursor-pointer h-1 bg-gray-200 rounded-lg appearance-none"
      />
    </div>
  );
}

function ToggleGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-xl border transition ${
            value === o.value
              ? "bg-gray-900 text-white border-gray-900 shadow-sm"
              : "bg-white text-gray-500 border-gray-200 hover:border-gray-350"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({
  label,
  enabled,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-b-0">
      <span className="text-xs font-bold text-gray-700">{label}</span>
      <div
        onClick={onToggle}
        className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${enabled ? "bg-orange-500" : "bg-gray-200"}`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
            enabled ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
    </div>
  );
}

function PosDot({
  active,
  v,
  a,
}: {
  active: boolean;
  v: "top" | "middle" | "bottom";
  a: "left" | "center" | "right";
}) {
  const cx = a === "left" ? 6 : a === "center" ? 12 : 18;
  const cy = v === "top" ? 6 : v === "middle" ? 12 : 18;
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="3"
        fill={active ? "#fff7ed" : "#f9fafb"}
        stroke={active ? "#f97316" : "#e5e7eb"}
        strokeWidth="1.5"
      />
      <circle cx={cx} cy={cy} r="2.5" fill={active ? "#f97316" : "#9ca3af"} />
    </svg>
  );
}
