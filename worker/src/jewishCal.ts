// Port of app/services/jewish_cal.py
import tables from "./tables.json";
import { cacheGet, cachePut, defaultCache, type CacheLike } from "./cache";

const CACHE_TTL_SECONDS = 86400; // the date changes at most once per day
const FETCH_TIMEOUT_MS = 3000;
const MONTHS = tables.jewishMonthsHe as Record<string, string>;

const UNITS = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
const HUNDREDS = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];

export function yearToHebrew(year: number): string {
  const y = year % 1000;
  const h = Math.floor(y / 100);
  const t = Math.floor((y % 100) / 10);
  const u = y % 10;
  let letters = HUNDREDS[h];
  const tu = t * 10 + u;
  if (tu === 15) letters += "טו";
  else if (tu === 16) letters += "טז";
  else letters += TENS[t] + UNITS[u];
  const chars = [...letters];
  if (chars.length > 1) return chars.slice(0, -1).join("") + "״" + chars[chars.length - 1];
  if (chars.length === 1) return letters + "׳";
  return letters;
}

/** Returns "day month\nyear" in Hebrew letters, or null on failure. isoDate is YYYY-MM-DD. */
export async function getJewishDate(
  isoDate: string,
  cache: CacheLike = defaultCache(),
  doFetch: typeof fetch = fetch,
): Promise<string | null> {
  const key = `hebcal/${isoDate}`;
  const cached = await cacheGet<string>(cache, key);
  if (cached) return cached;

  const [y, m, d] = isoDate.split("-").map(Number);
  try {
    const url = `https://www.hebcal.com/converter?gd=${d}&gm=${m}&gy=${y}&g2h=1&cfg=json`;
    const res = await doFetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const p = (await res.json()) as { hd: number | string; hm: string; hy: number | string };
    const dayStr = tables.hebrewDayNums[Number(p.hd) - 1];
    if (!dayStr) throw new Error(`bad day ${p.hd}`);
    const result = `${dayStr} ${MONTHS[p.hm] ?? p.hm}\n${yearToHebrew(Number(p.hy))}`;
    await cachePut(cache, key, result, CACHE_TTL_SECONDS);
    return result;
  } catch (err) {
    console.warn(`hebcal error [${isoDate}]: ${err}`);
    return null;
  }
}
