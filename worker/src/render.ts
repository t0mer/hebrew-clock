// Port of the drawing code in app/services/clock.py (lines 118-375).
// Builds an 800x480 SVG using Pillow's pixel conventions, rasterizes it with resvg
// (which shapes Hebrew + niqqud) and thresholds it to a 1-bit PNG.
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import sleepingPng from "../assets/sleeping-night.png";
import {
  dayName, getMode, getTimeLines, gregorianDate, splitPeriod, type FontName, type LocalTime,
} from "./core";
import { resolveFont, type FontFace } from "./fonts";
import { encodeBilevelPng } from "./png";
import tables from "./tables.json";
import type { Weather } from "./weather";

const W = 800;
const H = 480;
const PAD1 = 8;
const PAD2 = 16;

let wasmReady: Promise<void> | undefined;
function ensureWasm(): Promise<void> {
  // Do not cache a failed init, or one bad start would break the isolate until it is recycled.
  wasmReady ??= initWasm(resvgWasm).catch((err) => {
    wasmReady = undefined;
    throw err;
  });
  return wasmReady;
}

const fdiv = (a: number, b: number) => Math.floor(a / b); // Python's //
const rad = (deg: number) => (deg * Math.PI) / 180;
const num = (n: number) => +n.toFixed(3);
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const gray = (v: number) => `rgb(${v},${v},${v})`;
const px = (n: number) => num(n + 0.5); // Pillow pixel (n) -> centre of that pixel

/**
 * Pillow/raqm picks the paragraph direction from the first strong letter; resvg ignores
 * the SVG `direction` attribute and always lays out left-to-right. Wrapping Hebrew-first
 * strings in RLM (U+200F, invisible) gives the same RTL layout for digits and punctuation
 * ("11 בנובמבר" puts the number on the right, a trailing "!" goes to the left).
 */
function bidi(s: string): string {
  const m = s.match(/\p{L}/u);
  return m && /[֐-׿]/.test(m[0]) ? `‏${s}‏` : s;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

class Scene {
  private out: string[] = [];
  private widths = new Map<string, number>();

  constructor(private font: FontFace) {}

  private resvgOpts() {
    return {
      font: { fontBuffers: [this.font.data], loadSystemFonts: false, defaultFontFamily: this.font.family },
    };
  }

  private textAttrs(size: number): string {
    return `font-family="${esc(this.font.family)}" font-weight="${this.font.weight}" font-size="${size}"`;
  }

  /** Ink width of `text` at `size`; measured once at size 100, then scaled (shaped advances are linear). */
  width(text: string, size: number): number {
    let w100 = this.widths.get(text);
    if (w100 === undefined) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="400"><text x="1000" y="200" ${this.textAttrs(100)} text-anchor="middle">${esc(bidi(text))}</text></svg>`;
      const r = new Resvg(svg, this.resvgOpts());
      try {
        w100 = r.getBBox()?.width ?? 0;
      } finally {
        r.free();
      }
      this.widths.set(text, w100);
    }
    return (w100 * size) / 100;
  }

  rect(x0: number, y0: number, x1: number, y1: number, o: { fill?: number; outline?: number; width?: number }) {
    const w = o.width ?? 1;
    const fill = o.fill === undefined ? "none" : gray(o.fill);
    if (o.outline === undefined) {
      this.out.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0 + 1}" height="${y1 - y0 + 1}" fill="${fill}"/>`);
    } else {
      this.out.push(`<rect x="${x0 + w / 2}" y="${y0 + w / 2}" width="${x1 - x0 + 1 - w}" height="${y1 - y0 + 1 - w}" fill="${fill}" stroke="${gray(o.outline)}" stroke-width="${w}"/>`);
    }
  }

  /** PIL draw.ellipse([x0,y0,x1,y1]) (inclusive bbox, outline drawn inwards). */
  ellipse(x0: number, y0: number, x1: number, y1: number, o: { fill?: number; outline?: number; width?: number }) {
    const w = o.width ?? 1;
    const cx = (x0 + x1 + 1) / 2;
    const cy = (y0 + y1 + 1) / 2;
    const rx = (x1 - x0 + 1) / 2;
    const ry = (y1 - y0 + 1) / 2;
    const fill = o.fill === undefined ? "none" : gray(o.fill);
    if (o.outline === undefined) {
      this.out.push(`<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(rx)}" ry="${num(ry)}" fill="${fill}"/>`);
    } else {
      this.out.push(`<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(rx - w / 2)}" ry="${num(ry - w / 2)}" fill="${fill}" stroke="${gray(o.outline)}" stroke-width="${w}"/>`);
    }
  }

  line(pts: [number, number][], fill: number, width: number) {
    const p = pts.map(([x, y]) => `${px(x)},${px(y)}`).join(" ");
    this.out.push(`<polyline points="${p}" fill="none" stroke="${gray(fill)}" stroke-width="${width}"/>`);
  }

  polygon(pts: [number, number][], fill: number, outline: number) {
    const p = pts.map(([x, y]) => `${px(x)},${px(y)}`).join(" ");
    this.out.push(`<polygon points="${p}" fill="${gray(fill)}" stroke="${gray(outline)}" stroke-width="1"/>`);
  }

  /** PIL draw.text(..., anchor="mm"). */
  text(x: number, y: number, text: string, size: number, fill: number) {
    this.out.push(
      `<text x="${num(x)}" y="${num(y)}" ${this.textAttrs(size)} fill="${gray(fill)}" text-anchor="middle" dominant-baseline="central">${esc(bidi(text))}</text>`,
    );
  }

  image(dataUri: string, x: number, y: number, w: number, h: number) {
    this.out.push(`<image x="${x}" y="${y}" width="${w}" height="${h}" href="${dataUri}"/>`);
  }

  async render(background: number): Promise<Uint8Array> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${gray(background)}"/>${this.out.join("")}</svg>`;
    const r = new Resvg(svg, this.resvgOpts());
    try {
      const img = r.render();
      try {
        return await encodeBilevelPng(img.pixels, img.width, img.height);
      } finally {
        img.free();
      }
    } finally {
      r.free();
    }
  }
}

// ── Weather icons ────────────────────────────────────

function drawWeatherIcon(sc: Scene, cx: number, cy: number, iconKey: string, size = 38) {
  const s = size;

  const cloud = (ox = 0, oy = 0, scale = 1.0) => {
    const w = Math.trunc(s * 1.4 * scale);
    const h = Math.trunc(s * 0.7 * scale);
    const pts: [number, number][] = [];
    for (let a = 180; a <= 360; a += 8) {
      pts.push([ox + cx + Math.trunc((w / 2) * Math.cos(rad(a))), oy + cy + Math.trunc((h / 2) * Math.sin(rad(a)))]);
    }
    const bumps: [number, number, number][] = [
      [Math.trunc(w * 0.25), Math.trunc(h * 0.6 * scale), Math.trunc(h * 0.2)],
      [0, Math.trunc(h * 0.75 * scale), Math.trunc(h * 0.3)],
      [-Math.trunc(w * 0.25), Math.trunc(h * 0.55 * scale), Math.trunc(h * 0.1)],
    ];
    for (const [centre, rx, dy] of bumps) {
      for (let a = 0; a <= 180; a += 8) {
        pts.push([ox + cx + centre + Math.trunc(rx * Math.cos(rad(a))), oy + cy - dy + Math.trunc(rx * Math.sin(rad(a)))]);
      }
    }
    sc.polygon(pts, 255, 0);
  };

  switch (iconKey) {
    case "sun": {
      const r = fdiv(s, 2);
      sc.ellipse(cx - r, cy - r, cx + r, cy + r, { fill: 255, outline: 0, width: 3 });
      for (let a = 0; a < 360; a += 45) {
        const t = rad(a);
        sc.line([[cx + (r + 4) * Math.cos(t), cy + (r + 4) * Math.sin(t)], [cx + (r + 13) * Math.cos(t), cy + (r + 13) * Math.sin(t)]], 0, 3);
      }
      break;
    }
    case "sun_cloud": {
      const sr = fdiv(s, 3);
      const scx = cx - fdiv(s, 3);
      const scy = cy - fdiv(s, 4);
      sc.ellipse(scx - sr, scy - sr, scx + sr, scy + sr, { fill: 255, outline: 0, width: 2 });
      for (let a = 0; a < 360; a += 60) {
        const t = rad(a);
        sc.line([[scx + (sr + 3) * Math.cos(t), scy + (sr + 3) * Math.sin(t)], [scx + (sr + 9) * Math.cos(t), scy + (sr + 9) * Math.sin(t)]], 0, 2);
      }
      cloud(fdiv(s, 5), fdiv(s, 5), 0.85);
      break;
    }
    case "cloud":
      cloud();
      break;
    case "cloud_rain":
      cloud(0, fdiv(-s, 5), 0.9);
      for (const ox of [fdiv(-s, 3), fdiv(-s, 8), fdiv(s, 8), fdiv(s, 3)]) {
        sc.line([[cx + ox, cy + fdiv(s, 4)], [cx + ox - 4, cy + fdiv(s, 2) + 4]], 0, 2);
      }
      break;
    case "cloud_snow":
      cloud(0, fdiv(-s, 5), 0.9);
      for (const ox of [fdiv(-s, 3), fdiv(-s, 8), fdiv(s, 8), fdiv(s, 3)]) {
        const x = cx + ox;
        const y = cy + fdiv(s, 3);
        for (const a of [0, 60, 120]) {
          const t = rad(a);
          sc.line([[x - 6 * Math.cos(t), y - 6 * Math.sin(t)], [x + 6 * Math.cos(t), y + 6 * Math.sin(t)]], 0, 2);
        }
      }
      break;
    case "thunder":
      cloud(0, fdiv(-s, 4), 0.9);
      sc.line([[cx + 4, cy + fdiv(s, 6)], [cx - 6, cy + fdiv(s, 2)], [cx + 2, cy + fdiv(s, 2)], [cx - 8, cy + s]], 0, 3);
      break;
  }
}

// ── Analog clock ─────────────────────────────────────

function drawAnalogClock(sc: Scene, cx: number, cy: number, r: number, h24: number, m: number) {
  sc.ellipse(cx - r, cy - r, cx + r, cy + r, { outline: 0, width: 3 });
  for (let i = 0; i < 12; i++) {
    const a = rad(i * 30 - 90);
    const [inner, w] = i % 3 === 0 ? [12, 3] : [9, 2];
    sc.line([[cx + (r - 4) * Math.cos(a), cy + (r - 4) * Math.sin(a)], [cx + (r - inner) * Math.cos(a), cy + (r - inner) * Math.sin(a)]], 0, w);
  }
  const numSize = Math.max(12, fdiv(r, 4));
  for (const [n, deg] of [[12, -90], [3, 0], [6, 90], [9, 180]] as const) {
    const a = rad(deg);
    sc.text(cx + (r - 18) * Math.cos(a), cy + (r - 18) * Math.sin(a), String(n), numSize, 0);
  }
  const hourA = rad(((h24 % 12) + m / 60) * 30 - 90);
  sc.line([[cx, cy], [cx + r * 0.55 * Math.cos(hourA), cy + r * 0.55 * Math.sin(hourA)]], 0, 4);
  const minA = rad(m * 6 - 90);
  sc.line([[cx, cy], [cx + r * 0.75 * Math.cos(minA), cy + r * 0.75 * Math.sin(minA)]], 0, 2);
  sc.ellipse(cx - 4, cy - 4, cx + 4, cy + 4, { fill: 0 });
}

// ── Images ───────────────────────────────────────────

function frame(sc: Scene) {
  sc.rect(PAD1, PAD1, W - PAD1, H - PAD1, { outline: 0, width: 3 });
  sc.rect(PAD2, PAD2, W - PAD2, H - PAD2, { outline: 0, width: 1 });
}

function nightImage(sc: Scene): Promise<Uint8Array> {
  for (const [x, y, size] of tables.nightStars) sc.ellipse(x - size, y - size, x + size, y + size, { fill: 255 });

  const [mx, my, mr] = [100, 90, 55];
  sc.ellipse(mx - mr, my - mr, mx + mr, my + mr, { fill: 255 });
  sc.ellipse(mx - mr + 16, my - mr - 12, mx + mr + 16, my - mr - 12 + mr * 2, { fill: 0 });

  sc.image(`data:image/png;base64,${toBase64(new Uint8Array(sleepingPng))}`, W - 380 - 20, fdiv(H - 280, 2), 380, 280);

  const textCx = fdiv(W - 380 - 40, 2);
  sc.text(textCx, fdiv(H, 2) - 30, "זְמַן לִישׁוֹן", 72, 255);
  sc.text(textCx, fdiv(H, 2) + 55, "לַיְלָה טוֹב", 44, 180);
  return sc.render(0);
}

function quietImage(sc: Scene): Promise<Uint8Array> {
  frame(sc);
  sc.text(W / 2, fdiv(H, 2) - 50, "לֹא לְהָעִיר אַף אֶחָד!", 72, 0);
  sc.text(W / 2 - 60, fdiv(H, 2) + 30, "z", 72, 0);
  sc.text(W / 2, fdiv(H, 2) + 20, "z", 55, 0);
  sc.text(W / 2 + 50, fdiv(H, 2) + 10, "z", 38, 0);
  return sc.render(255);
}

function dayImage(sc: Scene, now: LocalTime, weather: Weather | null, jewishDate: string | null): Promise<Uint8Array> {
  const h24 = now.hour;
  const m = now.minute;
  frame(sc);

  const { timeLines, periodLine } = splitPeriod(getTimeLines(h24, m));

  const clockCx = fdiv(W, 2);
  const clockCy = PAD2 + 75;
  const clockR = 68;
  drawAnalogClock(sc, clockCx, clockCy, clockR, h24, m);

  const textStartY = clockCy + clockR + 15;
  const textAreaH = H - 110 - textStartY;
  const lineH = 95;
  const totalH = timeLines.length * lineH;
  const ty = Math.max(clockCy + clockR + 40, textStartY + fdiv(textAreaH - totalH, 2) + 10);

  timeLines.forEach((line, i) => {
    let size = 100;
    while (sc.width(line, size) >= W - 60 && size > 40) size -= 6;
    sc.text(W / 2, ty + i * lineH, line, size, 0);
  });

  const sepY = H - 105;
  sc.line([[PAD2 + 8, sepY], [W - PAD2 - 8, sepY]], 0, 1);
  const barCy = H - 52;
  const barLeft = PAD2 + 8;
  const barRight = W - PAD2 - 8;
  const barWidth = barRight - barLeft;
  const divX = barLeft + fdiv(barWidth, 3);
  const divX2 = barLeft + fdiv(2 * barWidth, 3);
  sc.line([[divX, H - 92], [divX, H - 15]], 0, 1);
  sc.line([[divX2, H - 92], [divX2, H - 15]], 0, 1);

  const day = dayName(now.weekday);
  let dateStr: string;
  let yearStr: string | null = null;
  if (jewishDate && jewishDate.includes("\n")) {
    const i = jewishDate.indexOf("\n");
    dateStr = jewishDate.slice(0, i);
    yearStr = jewishDate.slice(i + 1);
  } else {
    dateStr = jewishDate ? jewishDate : gregorianDate(now);
  }
  const leftCx = fdiv(barLeft + divX, 2);
  const cellW = divX - barLeft - 10;

  const fitSize = (text: string, start: number, minimum = 18) => {
    let size = start;
    while (sc.width(text, size) > cellW && size > minimum) size -= 2;
    return size;
  };

  if (yearStr) {
    sc.text(leftCx, barCy - 26, day, fitSize(day, 28), 0);
    sc.text(leftCx, barCy, dateStr, fitSize(dateStr, 26), 0);
    sc.text(leftCx, barCy + 24, yearStr, fitSize(yearStr, 22), 0);
  } else {
    sc.text(leftCx, barCy - 14, day, 34, 0);
    sc.text(leftCx, barCy + 14, dateStr, fitSize(dateStr, 34), 0);
  }

  if (periodLine) sc.text(fdiv(divX + divX2, 2), barCy, periodLine, 34, 0);

  if (weather) {
    const rightStart = divX2;
    const rightEnd = W - PAD2 - 8;
    const iconX = rightStart + fdiv(rightEnd - rightStart, 4);
    const textX = rightStart + fdiv(3 * (rightEnd - rightStart), 4);
    drawWeatherIcon(sc, iconX, barCy, weather.icon_key || "cloud", 34);
    sc.text(textX, barCy - 14, `${weather.temp}°`, 40, 0);
    sc.text(textX, barCy + 16, weather.desc ?? "", 34, 0);
  }
  return sc.render(255);
}

export interface RenderInput {
  font: FontName;
  sleepTime: boolean;
  now: LocalTime;
  weather: Weather | null;
  jewishDate: string | null;
}

export async function renderClock(input: RenderInput): Promise<Uint8Array> {
  await ensureWasm();
  const sc = new Scene(resolveFont(input.font));
  switch (getMode(input.sleepTime, input.now.hour, input.now.minute)) {
    case "night": return nightImage(sc);
    case "quiet": return quietImage(sc);
    default: return dayImage(sc, input.now, input.weather, input.jewishDate);
  }
}
