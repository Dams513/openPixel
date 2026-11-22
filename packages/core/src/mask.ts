/**
 * Selections are a bounding box plus an optional mask (1 byte per pixel of the
 * box, 1 = selected). Without mask the whole box is selected. On the wire the
 * mask is bit-packed and base64 encoded.
 */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bit-packed base64 mask over w*h (row-major). Omitted = whole rectangle. */
  mask?: string;
}

export interface MaskRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  mask?: Uint8Array;
}

export function encodeMask(mask: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i++) if (mask[i]) bytes[i >> 3] |= 1 << (i & 7);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}

export function decodeMask(b64: string, length: number): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
}

export function toRegion(r: MaskRegion): Region {
  const out: Region = { x: r.x, y: r.y, w: r.w, h: r.h };
  if (r.mask) out.mask = encodeMask(r.mask);
  return out;
}

export function fromRegion(r: Region): MaskRegion {
  return { x: r.x, y: r.y, w: r.w, h: r.h, mask: r.mask ? decodeMask(r.mask, r.w * r.h) : undefined };
}

/** Returns a predicate "is (x,y) inside the region". */
export function regionTester(r: MaskRegion): (x: number, y: number) => boolean {
  const { x: rx, y: ry, w, h, mask } = r;
  return (x, y) => {
    const i = x - rx, j = y - ry;
    if (i < 0 || j < 0 || i >= w || j >= h) return false;
    return !mask || mask[j * w + i] === 1;
  };
}

/** Build a tight region from absolute pixel indices of a width-wide canvas. */
export function regionFromIndices(indices: ArrayLike<number>, width: number): MaskRegion | null {
  if (!indices.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const x = i % width, y = (i - x) / width;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const x = i % width, y = (i - x) / width;
    mask[(y - y0) * w + (x - x0)] = 1;
  }
  return simplify({ x: x0, y: y0, w, h, mask });
}

/** Drop the mask when every pixel of the box is selected. */
export function simplify(r: MaskRegion): MaskRegion {
  if (r.mask && r.mask.every((v) => v === 1)) return { x: r.x, y: r.y, w: r.w, h: r.h };
  return r;
}

/** Combine two regions: union ('add') or difference ('subtract'). */
export function combineRegions(a: MaskRegion | null, b: MaskRegion | null, mode: 'add' | 'subtract'): MaskRegion | null {
  if (mode === 'add') {
    if (!a) return b;
    if (!b) return a;
  } else {
    if (!a) return null;
    if (!b) return a;
  }
  const ta = regionTester(a), tb = regionTester(b);
  const x0 = mode === 'add' ? Math.min(a.x, b.x) : a.x;
  const y0 = mode === 'add' ? Math.min(a.y, b.y) : a.y;
  const x1 = mode === 'add' ? Math.max(a.x + a.w, b.x + b.w) : a.x + a.w;
  const y1 = mode === 'add' ? Math.max(a.y + a.h, b.y + b.h) : a.y + a.h;
  const idx: number[] = [];
  const W = x1 - x0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const inside = mode === 'add' ? ta(x, y) || tb(x, y) : ta(x, y) && !tb(x, y);
    if (inside) idx.push((y - y0) * W + (x - x0));
  }
  const r = regionFromIndices(idx, W);
  return r ? { ...r, x: r.x + x0, y: r.y + y0 } : null;
}

/** Pixels inside a polygon (tested at pixel centres) plus its outline. */
export function polygonRegion(points: { x: number; y: number }[], width: number, height: number): MaskRegion | null {
  if (points.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const x0 = Math.max(0, Math.floor(minX)), y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(width - 1, Math.floor(maxX)), y1 = Math.min(height - 1, Math.floor(maxY));
  if (x1 < x0 || y1 < y0) return null;
  const W = x1 - x0 + 1;
  const idx = new Set<number>();
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const pi = points[i], pj = points[j];
        if ((pi.y > cy) !== (pj.y > cy) && cx < ((pj.x - pi.x) * (cy - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
      }
      if (inside) idx.add((y - y0) * W + (x - x0));
    }
  }
  // include the traced outline itself
  for (let k = 0; k < points.length; k++) {
    const a = points[k], b = points[(k + 1) % points.length];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2));
    for (let s = 0; s <= steps; s++) {
      const x = Math.floor(a.x + ((b.x - a.x) * s) / steps), y = Math.floor(a.y + ((b.y - a.y) * s) / steps);
      if (x >= x0 && y >= y0 && x <= x1 && y <= y1) idx.add((y - y0) * W + (x - x0));
    }
  }
  const r = regionFromIndices([...idx], W);
  return r ? { ...r, x: r.x + x0, y: r.y + y0 } : null;
}

/** Outline segments of a region (for drawing "marching ants"). Coordinates are pixel corners. */
export function regionOutline(r: MaskRegion): [number, number, number, number][] {
  if (!r.mask) return [[r.x, r.y, r.x + r.w, r.y], [r.x + r.w, r.y, r.x + r.w, r.y + r.h], [r.x, r.y + r.h, r.x + r.w, r.y + r.h], [r.x, r.y, r.x, r.y + r.h]];
  const t = regionTester(r);
  const segs: [number, number, number, number][] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (!t(x, y)) continue;
    if (!t(x, y - 1)) segs.push([x, y, x + 1, y]);
    if (!t(x, y + 1)) segs.push([x, y + 1, x + 1, y + 1]);
    if (!t(x - 1, y)) segs.push([x, y, x, y + 1]);
    if (!t(x + 1, y)) segs.push([x + 1, y, x + 1, y + 1]);
  }
  return segs;
}
