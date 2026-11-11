import indexHtml from "../../app/templates/index.html";
import { getIsraelTime, getMode, normalizeFont, VALID_FONTS, DEFAULT_FONT } from "./core";
import type { Env } from "./env";
import { getJewishDate } from "./jewishCal";
import { renderClock } from "./render";
import { generateRobots, generateSitemap } from "./seo";
import { renderTemplate } from "./template";
import { getWeather } from "./weather";

const MAX_LOCATION_LENGTH = 100;

const text = (body: string, type: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": type } });
const notFound = () => Response.json({ detail: "Not Found" }, { status: 404 });

async function clock(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams;
  const font = normalizeFont(q.get("font") ?? DEFAULT_FONT);
  const location = q.get("location") || "Tel Aviv";
  // "." and ".." would resolve to a different wttr.in path; control characters are never a place.
  if (location.length > MAX_LOCATION_LENGTH || /^\.+$/.test(location.trim()) || /[\u0000-\u001f\u007f]/.test(location)) {
    return Response.json({ detail: "invalid location" }, { status: 400 });
  }
  const sleepTime = (q.get("sleeptime") ?? "0") === "1";
  const lag = env.DISPLAY_LAG === undefined || env.DISPLAY_LAG === "" ? 8 : Number(env.DISPLAY_LAG) || 0;
  const now = getIsraelTime(new Date(), lag);

  // Skip the network calls for images that do not show weather or a date.
  const day = getMode(sleepTime, now.hour, now.minute) === "day";
  const weather = day ? await getWeather(location, env.WTTR_URL || "https://wttr.in") : null;
  const jewishDate = day && q.get("calendar") === "jewish" ? await getJewishDate(now.isoDate) : null;

  const png = await renderClock({ font, sleepTime, now, weather, jewishDate });
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "no-cache" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ detail: "Method Not Allowed" }, { status: 405 });
    }
    const baseUrl = url.origin;

    try {
      switch (url.pathname) {
        case "/": {
          const q = url.searchParams;
          const html = renderTemplate(indexHtml, {
            fonts: [...VALID_FONTS].sort(),
            default_font: q.get("font") ?? DEFAULT_FONT,
            default_location: q.get("location") ?? "Tel Aviv",
            default_calendar: q.get("calendar") ?? "gregorian",
            gtag_id: env.GTAG_ID || null,
            base_url: baseUrl,
          });
          return text(html, "text/html; charset=utf-8");
        }
        case "/robots.txt":
          return text(generateRobots(baseUrl), "text/plain; charset=utf-8");
        case "/sitemap.xml":
          return text(generateSitemap(baseUrl), "application/xml");
        case "/health":
          return text("OK", "text/plain; charset=utf-8");
        case "/clock":
        case "/clock.png":
          return await clock(url, env);
      }
      if (url.pathname.startsWith("/static/")) {
        const assetUrl = new URL(url);
        assetUrl.pathname = url.pathname.slice("/static".length);
        return env.ASSETS.fetch(new Request(assetUrl, request));
      }
      return notFound();
    } catch (err) {
      console.error(`request failed: ${err}`);
      return Response.json({ detail: "Internal Server Error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
