export interface HeroSettings {
  logoWidth: number;
  logoHeight: number;
  logoBorderRadius: number;
  logoObjectFit: "cover" | "contain";
  logoFocalX: number;
  logoFocalY: number;
  textAlign: "left" | "center" | "right";
  textVerticalPosition: "top" | "middle" | "bottom";
  headingSize: number;
  subtitleSize: number;
  lineHeight: number;      // 80–300; divide by 100 for CSS value
  letterSpacing: number;   // -10–30; multiply by 0.01 for em
  heroHeight: number;      // vh
  coverObjectFit: "cover" | "contain";
  focalPointX: number;     // 0–100
  focalPointY: number;     // 0–100
  overlayOpacity: number;  // 0–100

  // Premium visual control variables
  fontPairing: "default" | "modern-serif" | "sleek-sans" | "warm-display";
  overlayType: "dark" | "solid-brand" | "gradient-brand" | "none";
  buttonStyle: "pill" | "rounded" | "sharp";
  primaryCtaText: string;
  secondaryCtaText: string;
  showSecondaryCta: boolean;
  showLogo: boolean;
  showSubtitle: boolean;
  showTags: boolean;
  showOpenBadge: boolean;
  navbarSticky: boolean;
  navbarBgStyle: "transparent" | "solid-brand" | "glass-blur" | "dark-tint";
  navbarFontSize: number;
  navbarMenuTextMenu: string;
  navbarMenuTextReviews: string;
  navbarMenuTextInfo: string;
  showPartnersSection: boolean;
  partnersStyle: "floating" | "stagnant";
  partnersSectionTitle: string;
  menuShowHeaderLabel: boolean;
  menuHeaderLabelText: string;
  menuTitleText: string;
  menuShowDescription: boolean;
  menuDescriptionText: string;
  menuBgColorType: "default" | "solid" | "gradient";
  menuCustomBgColor: string;
  menuCustomGradient: string;
  menuTitleSize: number;
  menuLabelSize: number;
  menuDescriptionSize: number;
  menuColumns: 1 | 2 | 3;
  menuCardBgStyle: "default" | "transparent" | "custom";
  menuCardCustomBgColor: string;
  menuCardBorderRadius: number;
  menuCardImageHeight: number;
  menuCardImageFit: "cover" | "contain";
  menuCardTextAlign: "left" | "center" | "right";
}

export const DEFAULT_HERO_SETTINGS: HeroSettings = {
  logoWidth: 40,
  logoHeight: 40,
  logoBorderRadius: 16,
  logoObjectFit: "cover",
  logoFocalX: 50,
  logoFocalY: 50,
  textAlign: "left",
  textVerticalPosition: "bottom",
  headingSize: 48,
  subtitleSize: 16,
  lineHeight: 100,
  letterSpacing: -2,
  heroHeight: 75,
  coverObjectFit: "cover",
  focalPointX: 50,
  focalPointY: 50,
  overlayOpacity: 85,

  // Default values for new premium properties
  fontPairing: "default",
  overlayType: "dark",
  buttonStyle: "rounded",
  primaryCtaText: "Order Online",
  secondaryCtaText: "Book a Table",
  showSecondaryCta: false,
  showLogo: true,
  showSubtitle: true,
  showTags: true,
  showOpenBadge: true,
  navbarSticky: false,
  navbarBgStyle: "transparent",
  navbarFontSize: 11,
  navbarMenuTextMenu: "Menu",
  navbarMenuTextReviews: "Reviews",
  navbarMenuTextInfo: "Info",
  showPartnersSection: true,
  partnersStyle: "floating",
  partnersSectionTitle: "Trusted Partners on RestoFlow",
  menuShowHeaderLabel: true,
  menuHeaderLabelText: "Elite Gastronomy",
  menuTitleText: "Explore Culinary Menu",
  menuShowDescription: true,
  menuDescriptionText: "Explore freshly made signature dishes, snacks, side selections, beverages, and desserts.",
  menuBgColorType: "default",
  menuCustomBgColor: "",
  menuCustomGradient: "",
  menuTitleSize: 30,
  menuLabelSize: 10,
  menuDescriptionSize: 14,
  menuColumns: 3,
  menuCardBgStyle: "default",
  menuCardCustomBgColor: "",
  menuCardBorderRadius: 16,
  menuCardImageHeight: 180,
  menuCardImageFit: "cover",
  menuCardTextAlign: "left",
};
