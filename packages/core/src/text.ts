import { toHex, TRANSPARENT, type RGBA } from './color';
import { compositePacked, findFrameIndex, findLayer, type Doc } from './doc';

const CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ#@$%&*+=?!<>~^:;/|()[]{}';

export interface TextRegionOptions {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Layer ref; if omitted the visible composite is used. */
  layer?: string | number;
  frame?: string | number;
}

export interface TextRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** One string per row, one char per pixel; "." is transparent. */
  rows: string[];
  /** char → hex colour */
  legend: Record<string, string>;
}

/**
 * Describe a region of the document as character rows + legend — the same
 * format accepted by the `grid` op, so a model can read, edit and write back.
 */
export function regionToText(doc: Doc, opts: TextRegionOptions = {}): TextRegion {
  const frame = findFrameIndex(doc, opts.frame);
  const buf = opts.layer !== undefined && opts.layer !== null && opts.layer !== ''
    ? findLayer(doc, opts.layer).cels[frame]
    : compositePacked(doc, { frame });
  const x = Math.max(0, Math.floor(opts.x ?? 0));
  const y = Math.max(0, Math.floor(opts.y ?? 0));
  const w = Math.max(0, Math.min(doc.width - x, Math.floor(opts.w ?? doc.width)));
  const h = Math.max(0, Math.min(doc.height - y, Math.floor(opts.h ?? doc.height)));

  // Assign chars: palette colours first (stable), then anything else.
  const charOf = new Map<RGBA, string>();
  const legend: Record<string, string> = {};
  let next = 0;
  const paletteHex = new Map(doc.palette.map((c, i) => [c.toLowerCase(), i] as const));
  const used = new Set<RGBA>();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used.add(buf[(y + j) * doc.width + x + i]);
  const sorted = [...used].filter((c) => c !== TRANSPARENT).sort((a, b) => {
    const pa = paletteHex.get(toHex(a)!) ?? 1e9, pb = paletteHex.get(toHex(b)!) ?? 1e9;
    return pa - pb || a - b;
  });
  for (const c of sorted) {
    const ch = next < CHARS.length ? CHARS[next++] : '?';
    charOf.set(c, ch);
    if (ch !== '?') legend[ch] = toHex(c)!;
  }
  const rows: string[] = [];
  for (let j = 0; j < h; j++) {
    let row = '';
    for (let i = 0; i < w; i++) {
      const c = buf[(y + j) * doc.width + x + i];
      row += c === TRANSPARENT ? '.' : charOf.get(c)!;
    }
    rows.push(row);
  }
  return { x, y, w, h, rows, legend };
}

/** Short human/LLM readable summary of a document. */
export function describeDoc(doc: Doc) {
  const counts = new Map<number, number>();
  for (const l of doc.layers) {
    let n = 0;
    const cel = l.cels[doc.activeFrame];
    for (let i = 0; i < cel.length; i++) if (cel[i] !== TRANSPARENT) n++;
    counts.set(doc.layers.indexOf(l), n);
  }
  return {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    activeLayer: doc.layers.find((l) => l.id === doc.activeLayerId)?.name,
    activeFrame: doc.activeFrame,
    frames: doc.frames.map((f, i) => ({ index: i, id: f.id, duration: f.duration })),
    layers: doc.layers.map((l, i) => ({
      index: i,
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      active: l.id === doc.activeLayerId,
      filledPixels: counts.get(i),
    })),
    palette: doc.palette,
    notes: 'Las capas van de abajo (index 0) hacia arriba. Coordenadas: x hacia la derecha, y hacia abajo, origen (0,0) arriba-izquierda.',
  };
}
