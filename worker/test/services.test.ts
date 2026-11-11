import { describe, expect, it, vi } from "vitest";
import type { CacheLike } from "../src/cache";
import { getJewishDate, yearToHebrew } from "../src/jewishCal";
import { codeToIcon, getWeather } from "../src/weather";

function memCache(): CacheLike & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    async match(u) { return store.get(u)?.clone(); },
    async put(u, r) { store.set(u, r.clone()); },
  };
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const wttr = (code = "113", temp = "23.4") => json({ current_condition: [{ temp_C: temp, weatherCode: code }] });

describe("weather", () => {
  it("maps wttr codes to icons", () => {
    expect([113, 116, 122, 296, 332, 389, 999].map(codeToIcon)).toEqual(
      ["sun", "sun_cloud", "cloud", "cloud_rain", "cloud_snow", "thunder", "cloud"]);
  });
  it("fetches once, then serves from cache", async () => {
    const f = vi.fn(async (..._a: any[]) => wttr("296", "18"));
    const c = memCache();
    const a = await getWeather("Tel Aviv", "https://wttr.in/", c, f as any);
    const b = await getWeather("Tel Aviv", "https://wttr.in", c, f as any);
    expect(a).toEqual({ temp: 18, icon_key: "cloud_rain", desc: "גֶּשֶׁם" });
    expect(b).toEqual(a);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("https://wttr.in/Tel%20Aviv?format=j1");
    expect((f.mock.calls[0] as any)[1].headers["User-Agent"]).toBe("curl/7.68.0");
  });
  it("returns null on failure and does not retry during back-off", async () => {
    const f = vi.fn(async (..._a: any[]) => json({}, 503));
    const c = memCache();
    expect(await getWeather("X", "https://wttr.in", c, f as any)).toBeNull();
    expect(await getWeather("X", "https://wttr.in", c, f as any)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("falls back to last good value when fresh entry is gone", async () => {
    const c = memCache();
    await getWeather("X", "https://wttr.in", c, (async () => wttr("113", "30")) as any);
    for (const k of [...c.store.keys()]) if (k.includes("weather/fresh")) c.store.delete(k);
    const f = vi.fn(async (..._a: any[]) => json({}, 500));
    expect(await getWeather("X", "https://wttr.in", c, f as any)).toMatchObject({ temp: 30 });
  });
});

describe("jewish date", () => {
  it("formats Hebrew years", () => {
    expect(yearToHebrew(5786)).toBe("תשפ״ו");
    expect(yearToHebrew(5775)).toBe("תשע״ה");
    expect(yearToHebrew(5776)).toBe("תשע״ו");
  });
  it("builds the date string and caches it", async () => {
    const f = vi.fn(async (..._a: any[]) => json({ hd: 27, hm: "Sivan", hy: 5786 }));
    const c = memCache();
    const a = await getJewishDate("2026-06-12", c, f as any);
    expect(a).toBe("כ״ז בְּסִיוָן\nתשפ״ו");
    expect(await getJewishDate("2026-06-12", c, f as any)).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("https://www.hebcal.com/converter?gd=12&gm=6&gy=2026&g2h=1&cfg=json");
  });
  it("returns null on failure", async () => {
    expect(await getJewishDate("2026-06-12", memCache(), (async () => json({}, 500)) as any)).toBeNull();
  });
});
