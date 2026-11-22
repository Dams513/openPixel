/** Minimal animated GIF89a encoder (works in Node and the browser). */
import { TRANSPARENT } from './color';

export interface GifFrame {
  /** Packed 0xRRGGBBAA pixels, length = width * height. */
  pixels: Uint32Array;
  /** Delay in milliseconds. */
  delay: number;
}

export interface GifOptions {
  scale?: number;
  /** 0 = loop forever (default). */
  loop?: number;
}

class ByteWriter {
  bytes: number[] = [];
  byte(b: number) { this.bytes.push(b & 255); }
  u16(n: number) { this.byte(n); this.byte(n >> 8); }
  str(s: string) { for (const c of s) this.byte(c.charCodeAt(0)); }
  all(a: ArrayLike<number>) { for (let i = 0; i < a.length; i++) this.bytes.push(a[i]); }
}

/** Build a ≤255 colour palette (index 0 reserved for transparency). */
function buildPalette(frames: GifFrame[]) {
  const counts = new Map<number, number>();
  for (const f of frames) for (const c of f.pixels) {
    if ((c & 255) < 128) continue;
    const rgb = c >>> 8;
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
  }
  let colors = [...counts.keys()];
  if (colors.length > 255) {
    // Fallback: uniform 6x7x6 cube (252 colours).
    colors = [];
    for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
      colors.push((Math.round((r * 255) / 5) << 16) | (Math.round((g * 255) / 6) << 8) | Math.round((b * 255) / 5));
    }
  }
  const exact = new Map<number, number>();
  colors.forEach((c, i) => exact.set(c, i + 1));
  const cache = new Map<number, number>();
  const indexOf = (c: number) => {
    if ((c & 255) < 128 || c === TRANSPARENT) return 0;
    const rgb = c >>> 8;
    const e = exact.get(rgb) ?? cache.get(rgb);
    if (e !== undefined) return e;
    let best = 1, bd = Infinity;
    const r = rgb >> 16, g = (rgb >> 8) & 255, b = rgb & 255;
    colors.forEach((p, i) => {
      const dr = (p >> 16) - r, dg = ((p >> 8) & 255) - g, db = (p & 255) - b;
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < bd) { bd = d; best = i + 1; }
    });
    cache.set(rgb, best);
    return best;
  };
  return { colors, indexOf };
}

function lzw(indices: Uint8Array, minCodeSize: number, out: ByteWriter) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();
  const block: number[] = [];
  let bitBuf = 0, bitCount = 0;
  const emit = (code: number) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      block.push(bitBuf & 255);
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bitCount > 0) block.push(bitBuf & 255);
  out.byte(minCodeSize);
  for (let i = 0; i < block.length; i += 255) {
    const sub = block.slice(i, i + 255);
    out.byte(sub.length);
    out.all(sub);
  }
  out.byte(0);
}

export function encodeGif(width: number, height: number, frames: GifFrame[], opts: GifOptions = {}): Uint8Array {
  const s = Math.max(1, Math.floor(opts.scale ?? 1));
  const W = width * s, H = height * s;
  if (W > 65535 || H > 65535) throw new Error('GIF demasiado grande');
  const { colors, indexOf } = buildPalette(frames);
  const w = new ByteWriter();
  w.str('GIF89a');
  w.u16(W); w.u16(H);
  w.byte(0xf7); // global colour table, 8 bits, 256 entries
  w.byte(0); w.byte(0);
  for (let i = 0; i < 256; i++) {
    const c = i === 0 ? 0 : colors[i - 1] ?? 0;
    w.byte(c >> 16); w.byte(c >> 8); w.byte(c);
  }
  if (frames.length > 1) {
    w.byte(0x21); w.byte(0xff); w.byte(11); w.str('NETSCAPE2.0');
    w.byte(3); w.byte(1); w.u16(opts.loop ?? 0); w.byte(0);
  }
  for (const f of frames) {
    w.byte(0x21); w.byte(0xf9); w.byte(4);
    w.byte((2 << 2) | 1); // dispose: restore to background, transparent colour flag
    w.u16(Math.max(2, Math.round(f.delay / 10)));
    w.byte(0); w.byte(0);
    w.byte(0x2c); w.u16(0); w.u16(0); w.u16(W); w.u16(H); w.byte(0);
    const idx = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const sy = Math.floor(y / s) * width;
      for (let x = 0; x < W; x++) idx[y * W + x] = indexOf(f.pixels[sy + Math.floor(x / s)]);
    }
    lzw(idx, 8, w);
  }
  w.byte(0x3b);
  return Uint8Array.from(w.bytes);
}
