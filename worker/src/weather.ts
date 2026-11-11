// Port of app/services/weather.py
import tables from "./tables.json";
import { cacheGet, cachePut, defaultCache, type CacheLike } from "./cache";

export const CACHE_TTL_SECONDS = 1800;
export const FAIL_BACKOFF_SECONDS = 600;
const LAST_GOOD_TTL_SECONDS = 86400;
const FETCH_TIMEOUT_MS = 3000; // a slow wttr.in must not stall the image request

export interface Weather {
  temp: number;
  icon_key: string;
  desc: string;
}

const CODE_TO_ICON: Record<number, string> = { 113: "sun", 116: "sun_cloud", 119: "cloud", 122: "cloud" };
const RAIN = new Set([176, 293, 296, 299, 302, 305, 308, 353, 356, 359]);
const SNOW = new Set([179, 182, 185, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371, 374, 377]);
const STORM = new Set([200, 386, 389, 392, 395]);
const DESC_MAP = tables.descMap as Record<string, string>;

export function codeToIcon(code: number): string {
  if (code in CODE_TO_ICON) return CODE_TO_ICON[code];
  if (RAIN.has(code)) return "cloud_rain";
  if (SNOW.has(code)) return "cloud_snow";
  if (STORM.has(code)) return "thunder";
  return "cloud";
}

export function parseWeather(payload: any): Weather {
  const cc = payload.current_condition[0];
  const temp = Math.round(parseFloat(cc.temp_C));
  if (!Number.isFinite(temp)) throw new Error("bad temp_C");
  const icon = codeToIcon(parseInt(cc.weatherCode, 10));
  return { temp, icon_key: icon, desc: DESC_MAP[icon] ?? "מְעֻנָּן" };
}

/**
 * Cached weather lookup. Fresh entry -> return it. Recent failure marker -> return the
 * last good value (or null) without calling wttr.in. Otherwise fetch; on failure set the
 * marker and fall back to the last good value, like the Python version.
 */
export async function getWeather(
  location: string,
  wttrBase: string,
  cache: CacheLike = defaultCache(),
  doFetch: typeof fetch = fetch,
): Promise<Weather | null> {
  const loc = encodeURIComponent(location);
  const fresh = await cacheGet<Weather>(cache, `weather/fresh/${loc}`);
  if (fresh) return fresh;

  const lastGood = (await cacheGet<Weather>(cache, `weather/last/${loc}`)) ?? null;
  if (await cacheGet<boolean>(cache, `weather/fail/${loc}`)) return lastGood;

  try {
    const url = `${wttrBase.replace(/\/+$/, "")}/${loc}?format=j1`;
    const res = await doFetch(url, { headers: { "User-Agent": "curl/7.68.0" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = parseWeather(await res.json());
    await Promise.all([
      cachePut(cache, `weather/fresh/${loc}`, result, CACHE_TTL_SECONDS),
      cachePut(cache, `weather/last/${loc}`, result, LAST_GOOD_TTL_SECONDS),
    ]);
    return result;
  } catch (err) {
    console.warn(`weather error [${location}]: ${err}`);
    await cachePut(cache, `weather/fail/${loc}`, true, FAIL_BACKOFF_SECONDS);
    return lastGood;
  }
}
