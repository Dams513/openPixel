import { parseColor, shade, TRANSPARENT, type RGBA } from './color';
import {
  activeLayer,
  checkBudget,
  checkSize,
  cloneDoc,
  createLayer,
  deserializeDoc,
  findFrameIndex,
  findLayer,
  makeId,
  type Doc,
  type Layer,
  type SerializedDoc,
} from './doc';
import { brush, ditherOn, ellipse, floodIndices, line, rect, roundBrush } from './raster';
import { fromRegion, regionTester, type Region } from './mask';
import { layoutText } from './font';
import { animationFrameCount, generateAnimation, type AnimPreset } from './anim';

export type LayerRef = string | number;
export type FrameRef = string | number;
export type Color = string | null;

interface Target {
  /** Layer id, name or index. Defaults to the active layer. */
  layer?: LayerRef;
  /** Frame index or id. Defaults to the active frame. */
  frame?: FrameRef;
  /** Only pixels inside this region can change (the editor's selection). */
  clip?: Region;
}

export type BrushShape = 'square' | 'round';
export type DitherPattern = 'checker' | 'bayer25' | 'bayer75';
export type Mirror = 'none' | 'x' | 'y' | 'xy';

/** Every change to a document is expressed as one of these serialisable ops. */
export type Op =
  | (Target & { type: 'plot'; points: number[]; color: Color; size?: number; shape?: BrushShape; dither?: DitherPattern; mirror?: Mirror })
  | (Target & { type: 'pixels'; pixels: [number, number, Color][] })
  | (Target & { type: 'line'; x1: number; y1: number; x2: number; y2: number; color: Color; size?: number; mirror?: Mirror })
  | (Target & { type: 'rect'; x: number; y: number; w: number; h: number; color: Color; filled?: boolean; thickness?: number; mirror?: Mirror })
  | (Target & { type: 'ellipse'; x: number; y: number; w: number; h: number; color: Color; filled?: boolean; mirror?: Mirror })
  | (Target & { type: 'fill'; x: number; y: number; color: Color; contiguous?: boolean })
  | (Target & { type: 'grid'; x: number; y: number; rows: string[]; legend: Record<string, Color>; skip?: string })
  | (Target & { type: 'replaceColor'; from: Color; to: Color; allLayers?: boolean })
  | (Target & { type: 'clear'; x?: number; y?: number; w?: number; h?: number })
  | (Target & { type: 'shade'; points: number[]; amount: number; size?: number; shape?: BrushShape; mirror?: Mirror })
  | (Target & { type: 'flip'; axis: 'h' | 'v' })
  | (Target & { type: 'rotate'; dir: 'cw' | 'ccw' | '180' })
  | (Target & { type: 'shift'; dx: number; dy: number; wrap?: boolean })
  | (Target & { type: 'paste'; x: number; y: number; width: number; height: number; pixels: Color[]; skipTransparent?: boolean })
  | (Target & { type: 'moveRegion'; x: number; y: number; w: number; h: number; dx: number; dy: number; copy?: boolean; mask?: string })
  | (Target & {
      type: 'text'; x: number; y: number; text: string; color: Color;
      font?: string; scale?: number; spacing?: number; lineSpacing?: number;
      align?: 'left' | 'center' | 'right'; outline?: Color; shadow?: Color;
    })
  | { type: 'addLayer'; id?: string; name?: string; index?: number }
  | { type: 'duplicateLayer'; layer?: LayerRef; id?: string }
  | { type: 'deleteLayer'; layer?: LayerRef }
  | { type: 'updateLayer'; layer?: LayerRef; name?: string; visible?: boolean; opacity?: number; locked?: boolean }
  | { type: 'moveLayer'; layer?: LayerRef; index: number }
  | { type: 'mergeDown'; layer?: LayerRef }
  | { type: 'addFrame'; id?: string; index?: number; duplicate?: boolean; duration?: number }
  | { type: 'deleteFrame'; frame?: FrameRef }
  | { type: 'moveFrame'; frame?: FrameRef; index: number }
  | { type: 'updateFrame'; frame?: FrameRef; duration: number }
  | { type: 'setPalette'; colors: string[] }
  | { type: 'resize'; width: number; height: number; anchor?: Anchor }
  | { type: 'rename'; name: string }
  /** Generate animation frames from the sprite on a layer (see anim.ts). */
  | {
      type: 'animate'; preset: AnimPreset; layer?: LayerRef; frame?: FrameRef;
      mode?: 'replace' | 'append'; duration?: number; intensity?: number;
      facing?: 'right' | 'left'; legSplit?: number; ids?: string[];
    }
  | { type: 'load'; doc: SerializedDoc }
  /** Changes the active layer/frame. Not recorded in history. */
  | { type: 'select'; layer?: LayerRef; frame?: FrameRef };

export type OpType = Op['type'];

export type Anchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

export const STRUCTURAL_OPS: ReadonlySet<OpType> = new Set<OpType>([
  'addLayer', 'duplicateLayer', 'deleteLayer', 'updateLayer', 'moveLayer', 'mergeDown',
  'addFrame', 'deleteFrame', 'moveFrame', 'updateFrame', 'setPalette', 'resize', 'rename', 'load', 'animate',
]);

export type Change =
  | { kind: 'pixels'; layerId: string; frame: number; idx: Uint32Array; before: Uint32Array; after: Uint32Array }
  | { kind: 'snapshot'; before: Doc; after: Doc };

export interface Bounds { x: number; y: number; w: number; h: number }

/** Fill in generated ids so that an op applies identically on every replica. */
export function normalizeOp(op: Op): Op {
  switch (op.type) {
    case 'addLayer':
    case 'duplicateLayer':
      return op.id ? op : { ...op, id: makeId('layer') };
    case 'addFrame':
      return op.id ? op : { ...op, id: makeId('frame') };
    case 'animate':
      return op.ids ? op : { ...op, ids: Array.from({ length: animationFrameCount(op.preset) }, () => makeId('frame')) };
    default:
      return op;
  }
}

let openPatches: PixelPatch[] | null = null;

class PixelPatch {
  private before = new Map<number, number>();
  private inClip: ((x: number, y: number) => boolean) | null;
  constructor(readonly doc: Doc, readonly layer: Layer, readonly frame: number, readonly buf: Uint32Array, clip?: Region) {
    this.inClip = clip ? regionTester(fromRegion(clip)) : null;
  }
  set(i: number, c: RGBA) {
    if (this.inClip) {
      const x = i % this.doc.width;
      if (!this.inClip(x, (i - x) / this.doc.width)) return;
    }
    const cur = this.buf[i];
    if (cur === c) return;
    if (!this.before.has(i)) this.before.set(i, cur);
    this.buf[i] = c;
  }
  plot(x: number, y: number, c: RGBA) {
    const { width, height } = this.doc;
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    this.set(y * width + x, c);
  }
  get(x: number, y: number): RGBA {
    return this.buf[y * this.doc.width + x];
  }
  revert() {
    for (const [i, b] of this.before) this.buf[i] = b;
    this.before.clear();
  }
  toChange(): Change | null {
    const idx: number[] = [], before: number[] = [], after: number[] = [];
    for (const [i, b] of this.before) {
      const a = this.buf[i];
      if (a === b) continue;
      idx.push(i); before.push(b); after.push(a);
    }
    if (!idx.length) return null;
    return { kind: 'pixels', layerId: this.layer.id, frame: this.frame, idx: Uint32Array.from(idx), before: Uint32Array.from(before), after: Uint32Array.from(after) };
  }
}

function target(doc: Doc, t: Target, useClip = true): PixelPatch {
  const layer = findLayer(doc, t.layer);
  const frame = findFrameIndex(doc, t.frame);
  if (layer.locked) throw new Error(`La capa "${layer.name}" está bloqueada`);
  const p = new PixelPatch(doc, layer, frame, layer.cels[frame], useClip ? t.clip : undefined);
  openPatches?.push(p);
  return p;
}

/** Return a plot function that also paints mirrored copies. */
function mirrored(doc: Doc, mirror: Mirror | undefined, plot: (x: number, y: number) => void) {
  if (!mirror || mirror === 'none') return plot;
  const W = doc.width - 1, H = doc.height - 1;
  return (x: number, y: number) => {
    plot(x, y);
    if (mirror === 'x' || mirror === 'xy') plot(W - x, y);
    if (mirror === 'y' || mirror === 'xy') plot(x, H - y);
    if (mirror === 'xy') plot(W - x, H - y);
  };
}

const int = (n: number, name: string) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`"${name}" debe ser un número`);
  return Math.round(n);
};

function applyPixelOp(doc: Doc, op: Op): Change[] {
  switch (op.type) {
    case 'plot': {
      const p = target(doc, op);
      const c = parseColor(op.color);
      const size = Math.max(1, Math.min(64, op.size ?? 1));
      const stamp = op.shape === 'round' ? roundBrush : brush;
      const put = mirrored(doc, op.mirror, (x, y) => {
        if (op.dither && !ditherOn(x, y, op.dither)) return;
        p.plot(x, y, c);
      });
      const pts = op.points;
      if (pts.length === 2) stamp(pts[0], pts[1], size, put);
      for (let i = 2; i + 1 < pts.length; i += 2) {
        line(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], (x, y) => stamp(x, y, size, put));
      }
      return single(p);
    }
    case 'shade': {
      const p = target(doc, op);
      const size = Math.max(1, Math.min(64, op.size ?? 1));
      const stamp = op.shape === 'round' ? roundBrush : brush;
      const done = new Set<number>();
      const put = mirrored(doc, op.mirror, (x, y) => {
        if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
        const i = y * doc.width + x;
        if (done.has(i)) return;
        done.add(i);
        p.set(i, shade(p.buf[i], op.amount));
      });
      const pts = op.points;
      if (pts.length === 2) stamp(pts[0], pts[1], size, put);
      for (let i = 2; i + 1 < pts.length; i += 2) {
        line(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], (x, y) => stamp(x, y, size, put));
      }
      return single(p);
    }
    case 'pixels': {
      const p = target(doc, op);
      for (const [x, y, col] of op.pixels) p.plot(int(x, 'x'), int(y, 'y'), parseColor(col));
      return single(p);
    }
    case 'line': {
      const p = target(doc, op);
      const c = parseColor(op.color);
      const size = Math.max(1, op.size ?? 1);
      const put = mirrored(doc, op.mirror, (x, y) => p.plot(x, y, c));
      line(int(op.x1, 'x1'), int(op.y1, 'y1'), int(op.x2, 'x2'), int(op.y2, 'y2'), (x, y) => brush(x, y, size, put));
      return single(p);
    }
    case 'rect': {
      const p = target(doc, op);
      const c = parseColor(op.color);
      const put = mirrored(doc, op.mirror, (x, y) => p.plot(x, y, c));
      rect(int(op.x, 'x'), int(op.y, 'y'), int(op.w, 'w'), int(op.h, 'h'), !!op.filled, put, Math.max(1, op.thickness ?? 1));
      return single(p);
    }
    case 'ellipse': {
      const p = target(doc, op);
      const c = parseColor(op.color);
      const put = mirrored(doc, op.mirror, (x, y) => p.plot(x, y, c));
      ellipse(int(op.x, 'x'), int(op.y, 'y'), int(op.w, 'w'), int(op.h, 'h'), !!op.filled, put);
      return single(p);
    }
    case 'fill': {
      const p = target(doc, op);
      const c = parseColor(op.color);
      for (const i of floodIndices(p.buf, doc.width, doc.height, int(op.x, 'x'), int(op.y, 'y'), op.contiguous !== false)) p.set(i, c);
      return single(p);
    }
    case 'grid': {
      const p = target(doc, op);
      const skip = new Set((op.skip ?? '. ').split(''));
      const legend = new Map<string, RGBA>();
      for (const [k, v] of Object.entries(op.legend ?? {})) {
        if ([...k].length !== 1) throw new Error(`Las claves del legend deben ser 1 carácter (recibido "${k}")`);
        legend.set(k, parseColor(v));
      }
      const x0 = int(op.x ?? 0, 'x'), y0 = int(op.y ?? 0, 'y');
      op.rows.forEach((row, j) => {
        [...row].forEach((ch, i) => {
          if (legend.has(ch)) p.plot(x0 + i, y0 + j, legend.get(ch)!);
          else if (!skip.has(ch)) throw new Error(`Carácter "${ch}" (fila ${j}, columna ${i}) no está en el legend`);
        });
      });
      return single(p);
    }
    case 'replaceColor': {
      const from = parseColor(op.from), to = parseColor(op.to);
      const frame = findFrameIndex(doc, op.frame);
      const layers = op.allLayers ? doc.layers.filter((l) => !l.locked) : [findLayer(doc, op.layer)];
      const out: Change[] = [];
      for (const layer of layers) {
        const p = target(doc, { layer: layer.id, frame, clip: op.clip });
        for (let i = 0; i < p.buf.length; i++) if (p.buf[i] === from) p.set(i, to);
        out.push(...single(p));
      }
      return out;
    }
    case 'clear': {
      const p = target(doc, op);
      if (op.x === undefined && op.w === undefined) {
        for (let i = 0; i < p.buf.length; i++) p.set(i, TRANSPARENT);
      } else {
        rect(op.x ?? 0, op.y ?? 0, op.w ?? doc.width, op.h ?? doc.height, true, (x, y) => p.plot(x, y, TRANSPARENT));
      }
      return single(p);
    }
    case 'flip': {
      const p = target(doc, op);
      const src = p.buf.slice();
      const { width: W, height: H } = doc;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const sx = op.axis === 'h' ? W - 1 - x : x;
        const sy = op.axis === 'v' ? H - 1 - y : y;
        p.set(y * W + x, src[sy * W + sx]);
      }
      return single(p);
    }
    case 'rotate': {
      const p = target(doc, op);
      const src = p.buf.slice();
      const { width: W, height: H } = doc;
      if (op.dir !== '180' && W !== H) throw new Error('Rotar 90° requiere un lienzo cuadrado (usa "180" o redimensiona)');
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let sx: number, sy: number;
        if (op.dir === '180') { sx = W - 1 - x; sy = H - 1 - y; }
        else if (op.dir === 'cw') { sx = y; sy = W - 1 - x; }
        else { sx = W - 1 - y; sy = x; }
        p.set(y * W + x, src[sy * W + sx]);
      }
      return single(p);
    }
    case 'shift': {
      const p = target(doc, op);
      const src = p.buf.slice();
      const { width: W, height: H } = doc;
      const dx = int(op.dx, 'dx'), dy = int(op.dy, 'dy');
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let sx = x - dx, sy = y - dy;
        if (op.wrap) { sx = ((sx % W) + W) % W; sy = ((sy % H) + H) % H; }
        p.set(y * W + x, sx < 0 || sy < 0 || sx >= W || sy >= H ? TRANSPARENT : src[sy * W + sx]);
      }
      return single(p);
    }
    case 'paste': {
      const p = target(doc, op);
      const { width: w, height: h } = op;
      if (op.pixels.length !== w * h) throw new Error(`paste: se esperaban ${w * h} píxeles, llegaron ${op.pixels.length}`);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const c = parseColor(op.pixels[j * w + i]);
        if (op.skipTransparent && c === TRANSPARENT) continue;
        p.plot(op.x + i, op.y + j, c);
      }
      return single(p);
    }
    case 'moveRegion': {
      const p = target(doc, op, false);
      const { width: W, height: H } = doc;
      const x0 = Math.max(0, op.x), y0 = Math.max(0, op.y);
      const x1 = Math.min(W, op.x + op.w), y1 = Math.min(H, op.y + op.h);
      const inside = regionTester(fromRegion({ x: op.x, y: op.y, w: op.w, h: op.h, mask: op.mask }));
      const pix: { x: number; y: number; c: RGBA }[] = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (!inside(x, y)) continue;
        const c = p.get(x, y);
        pix.push({ x, y, c });
        if (!op.copy) p.plot(x, y, TRANSPARENT);
      }
      for (const { x, y, c } of pix) if (c !== TRANSPARENT) p.plot(x + op.dx, y + op.dy, c);
      return single(p);
    }
    case 'text': {
      const p = target(doc, op);
      const c = parseColor(op.color);
      const outline = op.outline !== undefined && op.outline !== null ? parseColor(op.outline) : null;
      const shadow = op.shadow !== undefined && op.shadow !== null ? parseColor(op.shadow) : null;
      const s = Math.max(1, Math.min(16, Math.floor(op.scale ?? 1)));
      if (String(op.text ?? '').length > 2000) throw new Error('Texto demasiado largo (máximo 2000 caracteres)');
      const lay = layoutText(String(op.text ?? ''), { font: op.font, scale: s, spacing: op.spacing, lineSpacing: op.lineSpacing, align: op.align });
      const ox = int(op.x, 'x') - (op.align === 'center' ? Math.floor(lay.width / 2) : op.align === 'right' ? lay.width : 0);
      const oy = int(op.y, 'y');
      if (shadow !== null) for (const [x, y] of lay.pixels) p.plot(ox + x + s, oy + y + s, shadow);
      if (outline !== null) {
        for (const [x, y] of lay.pixels) for (let j = -s; j <= s; j += s) for (let i = -s; i <= s; i += s) {
          if (i || j) p.plot(ox + x + i, oy + y + j, outline);
        }
      }
      for (const [x, y] of lay.pixels) p.plot(ox + x, oy + y, c);
      return single(p);
    }
    default:
      throw new Error(`Op desconocida: ${(op as Op).type}`);
  }
}

function single(p: PixelPatch): Change[] {
  const c = p.toChange();
  return c ? [c] : [];
}

const ANCHORS: Record<Anchor, [number, number]> = {
  'top-left': [0, 0], top: [0.5, 0], 'top-right': [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  'bottom-left': [0, 1], bottom: [0.5, 1], 'bottom-right': [1, 1],
};

function applyStructural(doc: Doc, op: Op) {
  const n = doc.width * doc.height;
  switch (op.type) {
    case 'addLayer': {
      checkBudget(doc.width, doc.height, doc.layers.length + 1, doc.frames.length);
      const layer = createLayer(doc.width, doc.height, doc.frames.length, op.name || `Capa ${doc.layers.length + 1}`, op.id);
      const activeIdx = doc.layers.indexOf(activeLayer(doc));
      const idx = op.index ?? activeIdx + 1;
      doc.layers.splice(Math.max(0, Math.min(doc.layers.length, idx)), 0, layer);
      doc.activeLayerId = layer.id;
      break;
    }
    case 'duplicateLayer': {
      checkBudget(doc.width, doc.height, doc.layers.length + 1, doc.frames.length);
      const src = findLayer(doc, op.layer);
      const copy: Layer = { ...src, id: op.id ?? makeId('layer'), name: `${src.name} copia`, locked: false, cels: src.cels.map((c) => c.slice()) };
      doc.layers.splice(doc.layers.indexOf(src) + 1, 0, copy);
      doc.activeLayerId = copy.id;
      break;
    }
    case 'deleteLayer': {
      const l = findLayer(doc, op.layer);
      if (doc.layers.length <= 1) throw new Error('No se puede borrar la única capa');
      const i = doc.layers.indexOf(l);
      doc.layers.splice(i, 1);
      if (doc.activeLayerId === l.id) doc.activeLayerId = doc.layers[Math.max(0, i - 1)].id;
      break;
    }
    case 'updateLayer': {
      const l = findLayer(doc, op.layer);
      if (op.name !== undefined) l.name = String(op.name).slice(0, 64) || l.name;
      if (op.visible !== undefined) l.visible = !!op.visible;
      if (op.opacity !== undefined) l.opacity = Math.max(0, Math.min(1, op.opacity));
      if (op.locked !== undefined) l.locked = !!op.locked;
      break;
    }
    case 'moveLayer': {
      const l = findLayer(doc, op.layer);
      const i = doc.layers.indexOf(l);
      doc.layers.splice(i, 1);
      doc.layers.splice(Math.max(0, Math.min(doc.layers.length, op.index)), 0, l);
      break;
    }
    case 'mergeDown': {
      const l = findLayer(doc, op.layer);
      const i = doc.layers.indexOf(l);
      if (i === 0) throw new Error('No hay capa debajo para combinar');
      const below = doc.layers[i - 1];
      below.cels.forEach((cel, f) => {
        const top = l.cels[f];
        for (let k = 0; k < n; k++) {
          if (top[k] === TRANSPARENT || !l.visible) continue;
          const sa = ((top[k] & 255) / 255) * l.opacity;
          cel[k] = blendInto(cel[k], top[k], sa);
        }
      });
      doc.layers.splice(i, 1);
      doc.activeLayerId = below.id;
      break;
    }
    case 'addFrame': {
      checkBudget(doc.width, doc.height, doc.layers.length, doc.frames.length + 1);
      const idx = Math.max(0, Math.min(doc.frames.length, op.index ?? doc.activeFrame + 1));
      const srcFrame = doc.activeFrame;
      doc.frames.splice(idx, 0, { id: op.id ?? makeId('frame'), duration: op.duration ?? doc.frames[srcFrame]?.duration ?? 100 });
      for (const l of doc.layers) l.cels.splice(idx, 0, op.duplicate ? l.cels[srcFrame].slice() : new Uint32Array(n));
      doc.activeFrame = idx;
      break;
    }
    case 'deleteFrame': {
      if (doc.frames.length <= 1) throw new Error('No se puede borrar el único frame');
      const i = findFrameIndex(doc, op.frame);
      doc.frames.splice(i, 1);
      for (const l of doc.layers) l.cels.splice(i, 1);
      doc.activeFrame = Math.min(doc.activeFrame, doc.frames.length - 1);
      break;
    }
    case 'moveFrame': {
      const i = findFrameIndex(doc, op.frame);
      const to = Math.max(0, Math.min(doc.frames.length - 1, op.index));
      const [f] = doc.frames.splice(i, 1);
      doc.frames.splice(to, 0, f);
      for (const l of doc.layers) { const [c] = l.cels.splice(i, 1); l.cels.splice(to, 0, c); }
      doc.activeFrame = to;
      break;
    }
    case 'updateFrame': {
      const i = findFrameIndex(doc, op.frame);
      doc.frames[i].duration = Math.max(10, Math.min(10000, Math.round(op.duration)));
      break;
    }
    case 'setPalette': {
      if (!Array.isArray(op.colors) || op.colors.length > 256) throw new Error('La paleta admite hasta 256 colores');
      doc.palette = op.colors.map((c) => {
        parseColor(c);
        return c.startsWith('#') ? c.toLowerCase() : c;
      });
      break;
    }
    case 'resize': {
      checkSize(op.width, op.height);
      checkBudget(op.width, op.height, doc.layers.length, doc.frames.length);
      const [ax, ay] = ANCHORS[op.anchor ?? 'top-left'] ?? ANCHORS['top-left'];
      const ox = Math.round((op.width - doc.width) * ax);
      const oy = Math.round((op.height - doc.height) * ay);
      for (const l of doc.layers) {
        l.cels = l.cels.map((cel) => {
          const out = new Uint32Array(op.width * op.height);
          for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
            const nx = x + ox, ny = y + oy;
            if (nx >= 0 && ny >= 0 && nx < op.width && ny < op.height) out[ny * op.width + nx] = cel[y * doc.width + x];
          }
          return out;
        });
      }
      doc.width = op.width;
      doc.height = op.height;
      break;
    }
    case 'rename':
      doc.name = String(op.name).slice(0, 100) || doc.name;
      break;
    case 'animate': {
      const layer = findLayer(doc, op.layer);
      const src = findFrameIndex(doc, op.frame);
      const gen = generateAnimation(layer.cels[src], doc.width, doc.height, op.preset,
        { intensity: op.intensity, facing: op.facing, legSplit: op.legSplit }, op.duration);
      const ids = op.ids ?? gen.cels.map(() => makeId('frame'));
      const frames = gen.cels.map((_, i) => ({ id: ids[i] ?? makeId('frame'), duration: gen.durations[i] }));
      const others = doc.layers.filter((l) => l !== layer).map((l) => [l, l.cels[src]] as const);
      checkBudget(doc.width, doc.height, doc.layers.length, (op.mode === 'append' ? doc.frames.length : 0) + frames.length);
      if (op.mode === 'append') {
        const at = doc.frames.length;
        doc.frames.push(...frames);
        layer.cels.push(...gen.cels);
        for (const [l, cel] of others) for (let i = 0; i < frames.length; i++) l.cels.push(cel.slice());
        doc.activeFrame = at;
      } else {
        doc.frames = frames;
        layer.cels = gen.cels;
        for (const [l, cel] of others) l.cels = frames.map(() => cel.slice());
        doc.activeFrame = 0;
      }
      doc.activeLayerId = layer.id;
      break;
    }
    case 'load': {
      const fresh = deserializeDoc(op.doc);
      Object.assign(doc, fresh);
      break;
    }
    default:
      throw new Error(`Op desconocida: ${op.type}`);
  }
}

function blendInto(dst: RGBA, src: RGBA, sa: number): RGBA {
  const da = (dst & 255) / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return TRANSPARENT;
  const mix = (s: number, d: number) => Math.round((s * sa + d * da * (1 - sa)) / oa);
  return (((mix(src >>> 24, dst >>> 24) << 24) | (mix((src >>> 16) & 255, (dst >>> 16) & 255) << 16) | (mix((src >>> 8) & 255, (dst >>> 8) & 255) << 8) | Math.round(oa * 255)) >>> 0);
}

/**
 * Apply one op to `doc` in place. Returns the reversible changes produced
 * (empty when nothing changed). Throws on invalid ops; on throw the doc is
 * left unchanged.
 */
export function applyOp(doc: Doc, op: Op): Change[] {
  if (op.type === 'select') {
    if (op.layer !== undefined) doc.activeLayerId = findLayer(doc, op.layer).id;
    if (op.frame !== undefined) doc.activeFrame = findFrameIndex(doc, op.frame);
    return [];
  }
  if (STRUCTURAL_OPS.has(op.type)) {
    const before = cloneDoc(doc);
    try {
      applyStructural(doc, op);
    } catch (e) {
      Object.assign(doc, before);
      throw e;
    }
    return [{ kind: 'snapshot', before, after: cloneDoc(doc) }];
  }
  const prev = openPatches;
  openPatches = [];
  try {
    return applyPixelOp(doc, op);
  } catch (e) {
    for (const p of openPatches.reverse()) p.revert();
    throw e;
  } finally {
    openPatches = prev;
  }
}

export function revertChange(doc: Doc, ch: Change) {
  if (ch.kind === 'snapshot') return Object.assign(doc, cloneDoc(ch.before));
  const buf = findLayer(doc, ch.layerId).cels[ch.frame];
  for (let k = 0; k < ch.idx.length; k++) buf[ch.idx[k]] = ch.before[k];
}

export function reapplyChange(doc: Doc, ch: Change) {
  if (ch.kind === 'snapshot') return Object.assign(doc, cloneDoc(ch.after));
  const buf = findLayer(doc, ch.layerId).cels[ch.frame];
  for (let k = 0; k < ch.idx.length; k++) buf[ch.idx[k]] = ch.after[k];
}

/** Bounding box of the pixels touched by a list of changes (null if none / structural only). */
export function changeBounds(doc: Doc, changes: Change[]): Bounds | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ch of changes) {
    if (ch.kind !== 'pixels') continue;
    for (const i of ch.idx) {
      const x = i % doc.width, y = (i - x) / doc.width;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function countChangedPixels(changes: Change[]): number {
  return changes.reduce((s, c) => s + (c.kind === 'pixels' ? c.idx.length : 0), 0);
}
