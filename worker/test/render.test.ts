import { describe, expect, it } from "vitest";
import type { FontName } from "../src/core";
import { renderClock, type RenderInput } from "../src/render";
import tables from "../src/tables.json";
import cases from "./fixtures/cases.json";
import golden from "./fixtures/golden.json";
import { decodePng, diffRatio, fromBase64, type Bilevel } from "./helpers";

// Worker output must stay visually close to the Python renderer (Pillow + raqm).
// Anti-aliasing and hinting differ, so about 1-2% of pixels is expected (measured
// 0.2-1.9%). A layout, direction or font regression moves it well beyond this.
const MAX_DIFF = 0.025;

type Case = (typeof cases)[number];

const input = (c: Case): RenderInput => {
  const [y, mo, d, h, mi] = c.at;
  const weekday = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
  const w = c.weather;
  return {
    font: c.font as FontName,
    sleepTime: c.sleep,
    now: { hour: h, minute: mi, day: d, month: mo, year: y, isoDate: "", weekday },
    weather: w ? { temp: w.temp, icon_key: w.icon, desc: (tables.descMap as Record<string, string>)[w.icon] } : null,
    jewishDate: c.jewish,
  };
};

describe("renderClock vs Python golden images", async () => {
  const refs = new Map<string, Bilevel>();
  for (const c of cases) refs.set(c.name, await decodePng(fromBase64((golden as Record<string, string>)[c.name])));

  for (const c of cases) {
    it(c.name, async () => {
      const out = await decodePng(await renderClock(input(c)));
      expect([out.width, out.height, out.bitDepth, out.colorType]).toEqual([800, 480, 1, 0]);
      expect(diffRatio(out, refs.get(c.name)!)).toBeLessThan(MAX_DIFF);

      // Missing or misplaced elements (weather block, year line, ...) may stay under a
      // percentage threshold, so also require the render to be closest to its own golden.
      const own = diffRatio(out, refs.get(c.name)!);
      for (const other of cases) {
        if (other.name !== c.name) expect(diffRatio(out, refs.get(other.name)!), `closer to ${other.name}`).toBeGreaterThan(own);
      }
    });
  }

  it("uses the fallback font when FrankRuhlLibre-Bold (a 14-byte stub file) is requested", async () => {
    const base = cases.find((c) => c.name === "day_noto")!;
    const stub = await renderClock({ ...input(base), font: "FrankRuhlLibre-Bold" });
    const noto = await renderClock({ ...input(base), font: "NotoSansHebrew-Bold" });
    expect(stub).toEqual(noto);
  });
});
