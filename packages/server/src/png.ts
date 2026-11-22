import { deflateSync } from 'node:zlib';
import { compositePacked, packedToBytes, type Doc } from '@openpixel/core';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA bytes as a PNG file. */
export function encodePng(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export interface RenderOptions {
  frame?: number;
  scale?: number;
  layerIds?: string[];
  /** Draw a checkerboard behind transparent pixels (for previews). */
  checkerboard?: boolean;
  /** Draw pixel grid lines (only when scale >= 4); every 8th line is stronger. */
  grid?: boolean;
  /** Region to crop (in document pixels). */
  region?: { x: number; y: number; w: number; h: number };
}

/** Render the document (or a region) to an upscaled RGBA buffer. */
export function render(doc: Doc, opts: RenderOptions = {}) {
  const packed = compositePacked(doc, { frame: opts.frame, layerIds: opts.layerIds });
  const src = packedToBytes(packed);
  const r = opts.region ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  const rx = Math.max(0, r.x), ry = Math.max(0, r.y);
  const rw = Math.max(1, Math.min(doc.width - rx, r.w)), rh = Math.max(1, Math.min(doc.height - ry, r.h));
  const s = Math.max(1, Math.min(64, Math.floor(opts.scale ?? 1)));
  const W = rw * s, H = rh * s;
  const out = new Uint8ClampedArray(W * H * 4);
  const grid = opts.grid && s >= 4;
  for (let y = 0; y < H; y++) {
    const py = ry + Math.floor(y / s);
    for (let x = 0; x < W; x++) {
      const px = rx + Math.floor(x / s);
      const si = (py * doc.width + px) * 4;
      const o = (y * W + x) * 4;
      let r0 = src[si], g0 = src[si + 1], b0 = src[si + 2];
      const a = src[si + 3] / 255;
      if (opts.checkerboard) {
        const cs = Math.max(2, Math.floor(s / 2));
        const bg = ((Math.floor(x / cs) + Math.floor(y / cs)) & 1) ? 204 : 255;
        r0 = r0 * a + bg * (1 - a); g0 = g0 * a + bg * (1 - a); b0 = b0 * a + bg * (1 - a);
        out[o + 3] = 255;
      } else {
        out[o + 3] = src[si + 3];
      }
      out[o] = r0; out[o + 1] = g0; out[o + 2] = b0;
      if (grid && (x % s === 0 || y % s === 0)) {
        const major = (x % s === 0 && px % 8 === 0) || (y % s === 0 && py % 8 === 0);
        const k = major ? 0.45 : 0.18;
        out[o] = out[o] * (1 - k) + 60 * k;
        out[o + 1] = out[o + 1] * (1 - k) + 60 * k;
        out[o + 2] = out[o + 2] * (1 - k) + 160 * k;
        out[o + 3] = 255;
      }
    }
  }
  return { width: W, height: H, data: out };
}

export function renderPng(doc: Doc, opts: RenderOptions = {}): Buffer {
  const r = render(doc, opts);
  return encodePng(r.width, r.height, r.data);
}

/** Pick an integer scale so the longest side is about `target` pixels. */
export function autoScale(w: number, h: number, target = 512): number {
  return Math.max(1, Math.min(32, Math.floor(target / Math.max(w, h))));
}

/** All frames side by side (with a small gap) — lets the model check an animation at a glance. */
export function renderSheetPng(doc: Doc, opts: { scale?: number; columns?: number } = {}): { png: Buffer; scale: number; columns: number } {
  const n = doc.frames.length;
  const columns = Math.max(1, Math.min(n, opts.columns ?? Math.min(n, 8)));
  const rows = Math.ceil(n / columns);
  const scale = opts.scale ?? Math.max(1, Math.min(16, Math.floor(1024 / (Math.max(doc.width * columns, doc.height * rows)))));
  const gap = 4;
  const fw = doc.width * scale, fh = doc.height * scale;
  const W = columns * fw + (columns + 1) * gap, H = rows * fh + (rows + 1) * gap;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < out.length; i += 4) { out[i] = 60; out[i + 1] = 60; out[i + 2] = 80; out[i + 3] = 255; }
  for (let f = 0; f < n; f++) {
    const r = render(doc, { frame: f, scale, checkerboard: true });
    const ox = gap + (f % columns) * (fw + gap), oy = gap + Math.floor(f / columns) * (fh + gap);
    for (let y = 0; y < fh; y++) {
      const src = y * fw * 4;
      out.set(r.data.subarray(src, src + fw * 4), ((oy + y) * W + ox) * 4);
    }
  }
  return { png: encodePng(W, H, out), scale, columns };
}
