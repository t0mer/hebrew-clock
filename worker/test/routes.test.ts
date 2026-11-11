import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { decodePng } from "./helpers";

const get = (path: string, init?: RequestInit) =>
  (exports as unknown as { default: { fetch: typeof fetch } }).default.fetch(new Request(`https://clock.example${path}`, init));

describe("routes", () => {
  it("GET /health", async () => {
    const r = await get("/health");
    expect([r.status, await r.text()]).toEqual([200, "OK"]);
  });

  it("GET /robots.txt uses the request origin", async () => {
    const t = await (await get("/robots.txt")).text();
    expect(t).toContain("Sitemap: https://clock.example/sitemap.xml");
    expect(t).toContain("Disallow: /api/");
  });

  it("GET /sitemap.xml lists the home page plus every font/location/calendar", async () => {
    const r = await get("/sitemap.xml");
    expect(r.headers.get("content-type")).toBe("application/xml");
    const xml = await r.text();
    expect(xml.match(/<url>/g)).toHaveLength(1 + 5 * 6 * 2);
    expect(xml).toContain("font=Heebo-Bold&amp;location=Tel%20Aviv&amp;calendar=jewish");
  });

  it("GET / renders the template without leftovers", async () => {
    const r = await get("/?font=Heebo-Bold&calendar=jewish");
    const html = await r.text();
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(html).not.toMatch(/{%|{{/);
    expect(html).toContain('<option value="Heebo-Bold" selected>');
    expect(html.match(/<option /g)).toHaveLength(5);
    expect(html).toContain('<link rel="canonical" href="https://clock.example/">');
    expect(html).toMatch(/value="jewish"\s*checked/);
    expect(html).not.toContain("googletagmanager"); // GTAG_ID is empty
  });

  it("GET / escapes query values", async () => {
    const html = await (await get('/?location=%22%3E%3Cscript%3Ealert(1)%3C/script%3E')).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&#34;&gt;&lt;script&gt;");
  });

  it("serves /static/tailwind.min.css from app/static", async () => {
    const r = await get("/static/tailwind.min.css");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/css");
  });

  it("GET /clock.png?sleeptime=1 returns a 1-bit PNG without touching the network", async () => {
    for (const path of ["/clock.png?sleeptime=1", "/clock?sleeptime=1&font=nope"]) {
      const r = await get(path);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      expect(r.headers.get("cache-control")).toBe("no-cache");
      const png = await decodePng(new Uint8Array(await r.arrayBuffer()));
      expect([png.width, png.height, png.bitDepth]).toEqual([800, 480, 1]);
    }
  });

  it("rejects very long, dot-only and control-character locations", async () => {
    for (const loc of ["a".repeat(101), "..", ".", "%0Abad"]) {
      expect((await get(`/clock.png?location=${loc}`)).status, loc).toBe(400);
    }
  });

  it("GET / does not 500 on template syntax in query values and never re-expands it", async () => {
    const r = await get("/?location=%7B%7Bx&font=%7B%25%20if%20x%20%25%7D&calendar=%7B%7B%20base_url%20%7D%7D");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('value="{{x"');
    expect(html).not.toContain("https://clock.example{{"); // {{ base_url }} stays literal text
  });

  it("day image through the route fetches weather and hebcal, then renders", async () => {
    const calls: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = String(input?.url ?? input);
      calls.push(url);
      if (url.includes("hebcal")) return new Response(JSON.stringify({ hd: 2, hm: "Kislev", hy: 5787 }));
      return new Response(JSON.stringify({ current_condition: [{ temp_C: "19", weatherCode: "116" }] }));
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z")); // 14:00 in Israel: a day image
    try {
      const r = await get("/clock.png?location=Routetest&calendar=jewish");
      expect(r.status).toBe(200);
      const png = await decodePng(new Uint8Array(await r.arrayBuffer()));
      expect([png.width, png.height, png.bitDepth]).toEqual([800, 480, 1]);
      expect(calls.some((u) => u.startsWith("https://wttr.in/Routetest?format=j1"))).toBe(true);
      expect(calls).toContain("https://www.hebcal.com/converter?gd=11&gm=11&gy=2026&g2h=1&cfg=json");
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("matches FastAPI for unknown paths and methods", async () => {
    expect((await get("/api/docs")).status).toBe(404);
    expect((await get("/nope")).status).toBe(404);
    expect((await get("/health", { method: "POST" })).status).toBe(405);
  });
});
