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

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmt12(h: number, m: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export type NextOpen =
  | { kind: "open" }                                                        // open now, or always-open / no hours set
  | { kind: "opens"; label: string; date: string; time: string; sameDay: boolean } // next opening window
  | { kind: "never" };                                                      // no open days configured

/**
 * Compute the next opening window in Africa/Lagos time. Handles: opens later
 * today, already closed today (opens a later day), closed all day, always open
 * (empty/missing hours), and no open days at all.
 *
 * `date`/`time` are Lagos wall-clock strings suitable for prefilling a
 * scheduled-order date/time input. `now` is injectable for testing.
 */
export function nextOpenTime(openingHours?: OpeningHours | null, now?: Date): NextOpen {
  if (!openingHours || Object.keys(openingHours).length === 0) return { kind: "open" };

  const base = now ?? new Date();
  const lagosNow = new Date(base.toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
  const curDay = lagosNow.getDay();
  const curMin = lagosNow.getHours() * 60 + lagosNow.getMinutes();
  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const pad = (v: number) => v.toString().padStart(2, "0");

  for (let offset = 0; offset < 7; offset++) {
    const dayH = openingHours[((curDay + offset) % 7).toString()];
    if (!dayH || !dayH.open || !dayH.from) continue;
    const from = toMin(dayH.from);
    const to = dayH.to ? toMin(dayH.to) : from;

    if (offset === 0) {
      if (curMin >= from && curMin < to) return { kind: "open" }; // open right now
      if (curMin >= to) continue;                                 // already closed today
      // else: opens later today → fall through to build
    }

    const [h, m] = dayH.from.split(":").map(Number);
    const target = new Date(lagosNow);
    target.setDate(target.getDate() + offset);
    target.setHours(h, m, 0, 0);
    const prefix = offset === 0 ? "" : offset === 1 ? "Tomorrow " : `${WEEKDAY_SHORT[target.getDay()]} `;
    return {
      kind: "opens",
      label: `${prefix}${fmt12(h, m)}`,
      date: `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`,
      time: `${pad(h)}:${pad(m)}`,
      sameDay: offset === 0,
    };
  }
  return { kind: "never" };
}
