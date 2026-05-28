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
};
