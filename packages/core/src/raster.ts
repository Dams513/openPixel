/** Pure geometry helpers. All return/accept integer pixel coordinates. */

export type Plot = (x: number, y: number) => void;

/** Bresenham line, inclusive of both endpoints. */
export function line(x0: number, y0: number, x1: number, y1: number, plot: Plot) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Square brush of `size` pixels centred on (x, y). */
export function brush(x: number, y: number, size: number, plot: Plot) {
  if (size <= 1) return plot(x, y);
  const off = Math.floor((size - 1) / 2);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) plot(x - off + i, y - off + j);
}

/** Round brush (diameter = size). */
export function roundBrush(x: number, y: number, size: number, plot: Plot) {
  if (size <= 2) return brush(x, y, size, plot);
  const r = size / 2;
  const off = Math.floor((size - 1) / 2);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = i + 0.5 - r, dy = j + 0.5 - r;
      if (dx * dx + dy * dy <= r * r) plot(x - off + i, y - off + j);
    }
  }
}

/** Normalise a rectangle given by two corners into x,y,w,h. */
export function rectFromCorners(x0: number, y0: number, x1: number, y1: number) {
  const x = Math.min(x0, x1), y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

export function rect(x: number, y: number, w: number, h: number, filled: boolean, plot: Plot, thickness = 1) {
  if (w <= 0 || h <= 0) return;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (filled || i < thickness || j < thickness || i >= w - thickness || j >= h - thickness) plot(x + i, y + j);
    }
  }
}

/**
 * Ellipse inscribed in the rectangle (x, y, w, h).
 * Based on Alois Zingl's rasterising algorithm (plotEllipseRect).
 */
export function ellipse(x: number, y: number, w: number, h: number, filled: boolean, plot: Plot) {
  if (w <= 0 || h <= 0) return;
  let x0 = x, y0 = y, x1 = x + w - 1, y1 = y + h - 1;
  if (w <= 2 || h <= 2) return rect(x, y, w, h, true, plot);
  const spans = new Map<number, [number, number]>();
  const put = (px: number, py: number) => {
    const s = spans.get(py);
    if (!s) spans.set(py, [px, px]);
    else { if (px < s[0]) s[0] = px; if (px > s[1]) s[1] = px; }
    if (!filled) plot(px, py);
  };
  let a = Math.abs(x1 - x0), b = Math.abs(y1 - y0), b1 = b & 1;
  let dx = 4 * (1 - a) * b * b, dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a, e2;
  if (x0 > x1) { x0 = x1; x1 += a; }
  if (y0 > y1) y0 = y1;
  y0 += (b + 1) >> 1; y1 = y0 - b1;
  a *= 8 * a; b1 = 8 * b * b;
  do {
    put(x1, y0); put(x0, y0); put(x0, y1); put(x1, y1);
    e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; err += dy += a; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    put(x0 - 1, y0); put(x1 + 1, y0++);
    put(x0 - 1, y1); put(x1 + 1, y1--);
  }
  if (filled) {
    for (const [py, [a0, a1]] of spans) for (let px = a0; px <= a1; px++) plot(px, py);
  }
}

/**
 * Flood fill. Returns the list of indices (y * width + x) to paint.
 * `contiguous=false` selects every pixel of the same colour.
 */
export function floodIndices(
  buf: Uint32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  contiguous = true,
): number[] {
  if (x < 0 || y < 0 || x >= width || y >= height) return [];
  const target = buf[y * width + x];
  const out: number[] = [];
  if (!contiguous) {
    for (let i = 0; i < buf.length; i++) if (buf[i] === target) out.push(i);
    return out;
  }
  const seen = new Uint8Array(width * height);
  const stack = [y * width + x];
  seen[y * width + x] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    const px = i % width, py = (i - px) / width;
    const visit = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const ni = ny * width + nx;
      if (seen[ni] || buf[ni] !== target) return;
      seen[ni] = 1;
      stack.push(ni);
    };
    visit(px + 1, py); visit(px - 1, py); visit(px, py + 1); visit(px, py - 1);
  }
  return out;
}

/** Ordered-dither (checkerboard) test used by the dither tool. */
export function ditherOn(x: number, y: number, pattern: 'checker' | 'bayer25' | 'bayer75' = 'checker'): boolean {
  if (pattern === 'checker') return ((x + y) & 1) === 0;
  const b = [[0, 2], [3, 1]][y & 1][x & 1];
  return pattern === 'bayer25' ? b === 0 : b !== 3;
}
