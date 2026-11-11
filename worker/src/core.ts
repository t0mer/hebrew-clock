// Pure logic ported from app/services/clock.py. No I/O, no rendering.
import tables from "./tables.json";

export const VALID_FONTS = [
  "DavidLibre-Bold",
  "FrankRuhlLibre-Bold",
  "FrankRuhlLibre",
  "Heebo-Bold",
  "NotoSansHebrew-Bold",
] as const;
export type FontName = (typeof VALID_FONTS)[number];
export const DEFAULT_FONT: FontName = "NotoSansHebrew-Bold";

const PERIOD_WORDS = new Set<string>(tables.periodWords);

export function normalizeFont(name: string | null | undefined): FontName {
  return (VALID_FONTS as readonly string[]).includes(name ?? "") ? (name as FontName) : DEFAULT_FONT;
}

export interface LocalTime {
  hour: number;
  minute: number;
  day: number;
  month: number; // 1-12
  year: number;
  weekday: number; // Monday = 0, like Python's datetime.weekday()
  /** YYYY-MM-DD of the Israel-local date */
  isoDate: string;
}

/**
 * Same rule as get_israel_time(): UTC+3 for months 3-10 (judged on the UTC month),
 * UTC+2 otherwise, then plus the display lag in seconds. Kept identical on purpose
 * so Docker and Workers always agree.
 */
export function getIsraelTime(now: Date = new Date(), displayLag = 0): LocalTime {
  const offsetHours = now.getUTCMonth() + 1 >= 3 && now.getUTCMonth() + 1 <= 10 ? 3 : 2;
  const t = new Date(now.getTime() + offsetHours * 3600_000 + displayLag * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return {
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    day: t.getUTCDate(),
    month: t.getUTCMonth() + 1,
    year: t.getUTCFullYear(),
    weekday: (t.getUTCDay() + 6) % 7,
    isoDate: `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
  };
}

export function getTimePeriod(h: number): string {
  if (h >= 6 && h < 12) return "בַּבֹּקֶר";
  if (h >= 12 && h < 16) return "בַּצָּהֳרַיִם";
  if (h >= 16 && h < 18) return "אַחַר הַצָּהֳרַיִם";
  if (h >= 18 && h < 21) return "בָּעֶרֶב";
  if (h >= 21 && h < 24) return "בַּלַּיְלָה";
  if (h >= 0 && h < 3) return "בַּלַּיְלָה";
  return "לִפְנוֹת בֹּקֶר";
}

/** Mirrors _get_time_lines: either [hours+minutes, period] or [hours, minutes, period]. */
export function getTimeLines(h24: number, m: number): string[] {
  const h12 = h24 % 12 || 12;
  const period = getTimePeriod(h24);
  const mp = tables.minutePrefix[m];
  const hp = tables.hours[h12 - 1];
  // Python len() counts code points; [...s] does too (String.length counts UTF-16 units).
  if ([...(hp + mp)].length > 25) return [hp, mp, period];
  return [hp + " " + mp, period];
}

export function splitPeriod(lines: string[]): { timeLines: string[]; periodLine: string } {
  return {
    timeLines: lines.filter((l) => !PERIOD_WORDS.has(l)),
    periodLine: lines.find((l) => PERIOD_WORDS.has(l)) ?? "",
  };
}

export type Mode = "night" | "quiet" | "day";

export function getMode(sleepTime: boolean, h24: number, m: number): Mode {
  if (sleepTime) return "night";
  if (h24 === 6 || (h24 === 7 && m < 30)) return "quiet";
  return "day";
}

export const dayName = (weekday: number): string => tables.daysHe[weekday];
export const gregorianDate = (t: LocalTime): string => `${t.day} ${tables.monthsHe[t.month - 1]}`;
