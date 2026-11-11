// Fonts are bundled from the repo root (shared with the Docker image).
import david from "../../DavidLibre-Bold.ttf";
import frankBold from "../../FrankRuhlLibre-Bold.ttf";
import frank from "../../FrankRuhlLibre.ttf";
import heebo from "../../Heebo-Bold.ttf";
import noto from "../../NotoSansHebrew-Bold.ttf";
import { DEFAULT_FONT, type FontName } from "./core";

export interface FontFace {
  family: string;
  weight: number;
  data: Uint8Array;
}

// FrankRuhlLibre-Bold.ttf in the repo is a 14-byte "404: Not Found" stub, so it is
// rejected below and falls back exactly like get_font() in clock.py.
const FONTS: Record<FontName, { family: string; weight: number; data: ArrayBuffer }> = {
  "DavidLibre-Bold": { family: "David Libre", weight: 700, data: david },
  "FrankRuhlLibre-Bold": { family: "Frank Ruhl Libre", weight: 700, data: frankBold },
  FrankRuhlLibre: { family: "Frank Ruhl Libre", weight: 400, data: frank },
  "Heebo-Bold": { family: "Heebo", weight: 400, data: heebo },
  "NotoSansHebrew-Bold": { family: "Noto Sans Hebrew", weight: 700, data: noto },
};

const MIN_VALID_BYTES = 1024;

/** Requested font, else NotoSansHebrew-Bold, else FrankRuhlLibre (same order as get_font). */
export function resolveFont(name: FontName): FontFace {
  for (const n of [name, DEFAULT_FONT, "FrankRuhlLibre" as FontName]) {
    const f = FONTS[n];
    if (f.data.byteLength >= MIN_VALID_BYTES) {
      return { family: f.family, weight: f.weight, data: new Uint8Array(f.data) };
    }
  }
  throw new Error("no usable font bundled");
}
