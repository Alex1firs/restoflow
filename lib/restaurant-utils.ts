export type DayHours = { open: boolean; from: string; to: string };
export type OpeningHours = Record<string, DayHours>;

export const DAYS = [
  { key: "1", label: "Monday" },
  { key: "2", label: "Tuesday" },
  { key: "3", label: "Wednesday" },
  { key: "4", label: "Thursday" },
  { key: "5", label: "Friday" },
  { key: "6", label: "Saturday" },
  { key: "0", label: "Sunday" },
];

export const DEFAULT_DAY_HOURS: DayHours = { open: true, from: "09:00", to: "22:00" };

export function defaultOpeningHours(): OpeningHours {
  const h: OpeningHours = {};
  DAYS.forEach((d) => { h[d.key] = { ...DEFAULT_DAY_HOURS }; });
  return h;
}

export function checkIsOpen(openingHours?: OpeningHours | null): boolean {
  if (!openingHours || Object.keys(openingHours).length === 0) return true;
  const lagosNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
  const day = lagosNow.getDay().toString();
  const dayH = openingHours[day];
  if (!dayH || !dayH.open) return false;
  const [fH, fM] = dayH.from.split(":").map(Number);
  const [tH, tM] = dayH.to.split(":").map(Number);
  const cur = lagosNow.getHours() * 60 + lagosNow.getMinutes();
  return cur >= fH * 60 + fM && cur < tH * 60 + tM;
}

export function todayHours(openingHours?: OpeningHours | null): DayHours | null {
  if (!openingHours) return null;
  const lagosNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
  return openingHours[lagosNow.getDay().toString()] ?? null;
}

export type DeliveryZone = {
  id: string;
  name: string;
  fee: number;
};
