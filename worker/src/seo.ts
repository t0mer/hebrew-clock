// Port of app/services/seo.py
import { VALID_FONTS } from "./core";

const SITEMAP_LOCATIONS = ["Tel Aviv", "Jerusalem", "Haifa", "Beer Sheva", "Eilat", "Netanya"];
const CALENDARS = ["gregorian", "jewish"];
const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

export function generateRobots(baseUrl: string): string {
  return `User-agent: *\nDisallow: /api/\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`;
}

function urlEntry(loc: string, priority: string): string {
  return `  <url>\n    <loc>${loc.replace(/&/g, "&amp;")}</loc>\n    <changefreq>daily</changefreq>\n    <priority>${priority}</priority>\n  </url>\n`;
}

export function generateSitemap(baseUrl: string): string {
  let entries = urlEntry(`${baseUrl}/`, "1.0");
  for (const font of [...VALID_FONTS].sort()) {
    for (const location of SITEMAP_LOCATIONS) {
      for (const calendar of CALENDARS) {
        const path = `/?font=${encodeURIComponent(font)}&location=${encodeURIComponent(location)}&calendar=${calendar}`;
        entries += urlEntry(`${baseUrl}${path}`, "0.8");
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${NS}">\n${entries}</urlset>\n`;
}
