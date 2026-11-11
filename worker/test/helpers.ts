// Decodes the 1-bit grayscale PNGs produced by Pillow and by src/png.ts.
export interface Bilevel {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** 1 = white, 0 = black, one entry per pixel */
  pixels: Uint8Array;
}

export async function decodePng(png: Uint8Array): Promise<Bilevel> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat: Uint8Array[] = [];
  while (off < png.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = v.getUint32(0); height = v.getUint32(4); bitDepth = data[8]; colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 1 || colorType !== 0) return { width, height, bitDepth, colorType, pixels: new Uint8Array(0) };

  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) { joined.set(c, o); o += c.length; }
  const stream = new Blob([joined]).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());

  const rowBytes = (width + 7) >> 3;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const row = raw.slice(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1));
    const prev = y ? rows[y - 1] : new Uint8Array(rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const a = i ? row[i - 1] : 0, b = prev[i], c = i ? prev[i - 1] : 0;
      if (filter === 1) row[i] = (row[i] + a) & 255;
      else if (filter === 2) row[i] = (row[i] + b) & 255;
      else if (filter === 3) row[i] = (row[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        row[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    rows.push(row);
  }
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels[y * width + x] = (rows[y][x >> 3] >> (7 - (x & 7))) & 1;
  }
  return { width, height, bitDepth, colorType, pixels };
}

export function diffRatio(a: Bilevel, b: Bilevel): number {
  let diff = 0;
  for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) diff++;
  return diff / a.pixels.length;
}

export const fromBase64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
