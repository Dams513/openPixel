/**
 * Colors are stored as unsigned 32-bit integers packed as 0xRRGGBBAA.
 * 0 means fully transparent.
 */
export type RGBA = number;

export const TRANSPARENT: RGBA = 0;

export type ColorInput = string | null | undefined;

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  orange: '#ff8000',
  purple: '#800080',
  pink: '#ff80c0',
  brown: '#8b4513',
};

/**
 * Parse "#rgb", "#rgba", "#rrggbb", "#rrggbbaa", a few CSS names,
 * or null / "transparent" / "none" (transparent).
 * Throws on invalid input.
 */
export function parseColor(input: ColorInput): RGBA {
  if (input === null || input === undefined) return TRANSPARENT;
  let s = String(input).trim().toLowerCase();
  if (s === '' || s === 'transparent' || s === 'none' || s === 'erase') return TRANSPARENT;
  if (NAMED[s]) s = NAMED[s];
  if (s[0] === '#') s = s.slice(1);
  if (!/^[0-9a-f]+$/.test(s)) throw new Error(`Color inválido: "${input}"`);
  let r: number, g: number, b: number, a = 255;
  if (s.length === 3 || s.length === 4) {
    r = parseInt(s[0] + s[0], 16);
    g = parseInt(s[1] + s[1], 16);
    b = parseInt(s[2] + s[2], 16);
    if (s.length === 4) a = parseInt(s[3] + s[3], 16);
  } else if (s.length === 6 || s.length === 8) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
    if (s.length === 8) a = parseInt(s.slice(6, 8), 16);
  } else {
    throw new Error(`Color inválido: "${input}"`);
  }
  if (a === 0) return TRANSPARENT;
  return pack(r, g, b, a);
}

export function pack(r: number, g: number, b: number, a = 255): RGBA {
  return (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
}

export function unpack(c: RGBA): [number, number, number, number] {
  return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** "#rrggbb" for opaque colors, "#rrggbbaa" otherwise, null for transparent. */
export function toHex(c: RGBA): string | null {
  if (c === TRANSPARENT) return null;
  const [r, g, b, a] = unpack(c);
  return '#' + hex2(r) + hex2(g) + hex2(b) + (a === 255 ? '' : hex2(a));
}

/** Like toHex but always returns a string ("#00000000" for transparent). */
export function toHexString(c: RGBA): string {
  return toHex(c) ?? '#00000000';
}

/** Normalize any color input to its canonical hex string (or null). */
export function normalizeColor(input: ColorInput): string | null {
  return toHex(parseColor(input));
}

/** Alpha-composite `src` over `dst` with an extra opacity factor (0..1). */
export function blendOver(dst: RGBA, src: RGBA, opacity = 1): RGBA {
  const sa = ((src & 255) / 255) * opacity;
  if (sa <= 0) return dst;
  const da = (dst & 255) / 255;
  if (sa >= 1 || da === 0) {
    if (sa >= 1) return src;
    return pack(src >>> 24, (src >>> 16) & 255, (src >>> 8) & 255, Math.round(sa * 255));
  }
  const oa = sa + da * (1 - sa);
  const mix = (s: number, d: number) => Math.round((s * sa + d * da * (1 - sa)) / oa);
  return pack(
    mix(src >>> 24, dst >>> 24),
    mix((src >>> 16) & 255, (dst >>> 16) & 255),
    mix((src >>> 8) & 255, (dst >>> 8) & 255),
    Math.round(oa * 255),
  );
}

/** HSL helpers (h: 0..360, s/l: 0..1) used by the shading tools. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/** Lighten (amount > 0) or darken (amount < 0) a color, keeping alpha. amount in -1..1. */
export function shade(c: RGBA, amount: number): RGBA {
  if (c === TRANSPARENT) return c;
  const [r, g, b, a] = unpack(c);
  const [h, s, l] = rgbToHsl(r, g, b);
  const nl = Math.min(1, Math.max(0, l + amount));
  const [nr, ng, nb] = hslToRgb(h, s, nl);
  return pack(nr, ng, nb, a);
}
