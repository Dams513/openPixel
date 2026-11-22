import { blendOver, TRANSPARENT, type RGBA } from './color';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  locked: boolean;
  /** One pixel buffer per frame (cels[frameIndex]), length = width * height. */
  cels: Uint32Array[];
}

export interface Frame {
  id: string;
  /** Display time in milliseconds. */
  duration: number;
}

export interface Doc {
  name: string;
  width: number;
  height: number;
  /** Bottom-most layer first. */
  layers: Layer[];
  frames: Frame[];
  palette: string[];
  activeLayerId: string;
  activeFrame: number;
}

export const MAX_SIZE = 1024;

export const DEFAULT_PALETTE = [
  '#000000', '#1d1d2b', '#3b3b54', '#5d5d7a', '#8b8ba8', '#c2c2d6', '#ffffff', '#f4e1c1',
  '#7a2e2e', '#c0392b', '#ff6b5b', '#ffb3a7', '#7a4a1e', '#d97a2b', '#ffb347', '#ffe08a',
  '#2e5a1e', '#3fa34d', '#8fd86b', '#d6f5a3', '#1e4a5a', '#2b8fbf', '#5ccfff', '#b3ecff',
  '#2a1e5a', '#5b3fbf', '#a58bff', '#ff7ad9', '#6b3a2a', '#a8683f', '#e0a878', '#4a3020',
];

let idCounter = 0;
export function makeId(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter.toString(36)}`;
}

export function checkSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_SIZE || height > MAX_SIZE) {
    throw new Error(`Tamaño inválido ${width}x${height} (debe ser entero entre 1 y ${MAX_SIZE})`);
  }
}

export function createLayer(width: number, height: number, frameCount: number, name: string, id = makeId('layer')): Layer {
  const cels: Uint32Array[] = [];
  for (let i = 0; i < frameCount; i++) cels.push(new Uint32Array(width * height));
  return { id, name, visible: true, opacity: 1, locked: false, cels };
}

export interface CreateDocOptions {
  name?: string;
  background?: RGBA;
  palette?: string[];
}

export function createDoc(width: number, height: number, opts: CreateDocOptions = {}): Doc {
  checkSize(width, height);
  const layer = createLayer(width, height, 1, 'Capa 1');
  if (opts.background) layer.cels[0].fill(opts.background);
  return {
    name: opts.name ?? 'Sin título',
    width,
    height,
    layers: [layer],
    frames: [{ id: makeId('frame'), duration: 100 }],
    palette: [...(opts.palette ?? DEFAULT_PALETTE)],
    activeLayerId: layer.id,
    activeFrame: 0,
  };
}

export function cloneDoc(doc: Doc): Doc {
  return {
    ...doc,
    layers: doc.layers.map((l) => ({ ...l, cels: l.cels.map((c) => c.slice()) })),
    frames: doc.frames.map((f) => ({ ...f })),
    palette: [...doc.palette],
  };
}

/** Replace the content of `target` with `source` in place (keeps object identity). */
export function assignDoc(target: Doc, source: Doc) {
  Object.assign(target, cloneDoc(source));
}

export function activeLayer(doc: Doc): Layer {
  return doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[doc.layers.length - 1];
}

/**
 * Resolve a layer reference: id, exact name (case-insensitive) or index
 * (number, 0 = bottom). Undefined → active layer.
 */
export function findLayer(doc: Doc, ref?: string | number | null): Layer {
  if (ref === undefined || ref === null || ref === '') return activeLayer(doc);
  if (typeof ref === 'number') {
    const l = doc.layers[ref];
    if (!l) throw new Error(`No existe la capa con índice ${ref}`);
    return l;
  }
  const byId = doc.layers.find((l) => l.id === ref);
  if (byId) return byId;
  const lower = ref.toLowerCase();
  const byName = doc.layers.find((l) => l.name.toLowerCase() === lower);
  if (byName) return byName;
  if (/^\d+$/.test(ref)) return findLayer(doc, Number(ref));
  throw new Error(`No existe la capa "${ref}". Capas: ${doc.layers.map((l) => `"${l.name}"`).join(', ')}`);
}

/** Resolve a frame reference (index or id). Undefined → active frame. */
export function findFrameIndex(doc: Doc, ref?: string | number | null): number {
  if (ref === undefined || ref === null || ref === '') return doc.activeFrame;
  if (typeof ref === 'number' || /^\d+$/.test(ref)) {
    const i = Number(ref);
    if (i < 0 || i >= doc.frames.length) throw new Error(`No existe el frame ${i} (hay ${doc.frames.length})`);
    return i;
  }
  const i = doc.frames.findIndex((f) => f.id === ref);
  if (i < 0) throw new Error(`No existe el frame "${ref}"`);
  return i;
}

export interface CompositeOptions {
  frame?: number;
  /** Only include these layer ids. */
  layerIds?: string[];
  /** Include hidden layers. */
  includeHidden?: boolean;
}

/** Flatten visible layers of a frame into a single RGBA (packed) buffer. */
export function compositePacked(doc: Doc, opts: CompositeOptions = {}): Uint32Array {
  const frame = opts.frame ?? doc.activeFrame;
  const out = new Uint32Array(doc.width * doc.height);
  for (const layer of doc.layers) {
    if (!opts.includeHidden && !layer.visible) continue;
    if (opts.layerIds && !opts.layerIds.includes(layer.id)) continue;
    const cel = layer.cels[frame];
    if (!cel) continue;
    const op = layer.opacity;
    for (let i = 0; i < cel.length; i++) {
      const c = cel[i];
      if (c !== TRANSPARENT) out[i] = blendOver(out[i], c, op);
    }
  }
  return out;
}

/** Convert a packed buffer into byte RGBA (for ImageData / PNG). */
export function packedToBytes(packed: Uint32Array, out?: Uint8ClampedArray): Uint8ClampedArray {
  const bytes = out ?? new Uint8ClampedArray(packed.length * 4);
  for (let i = 0, j = 0; i < packed.length; i++, j += 4) {
    const c = packed[i];
    bytes[j] = c >>> 24;
    bytes[j + 1] = (c >>> 16) & 255;
    bytes[j + 2] = (c >>> 8) & 255;
    bytes[j + 3] = c & 255;
  }
  return bytes;
}

export function bytesToPacked(bytes: ArrayLike<number>): Uint32Array {
  const out = new Uint32Array(bytes.length / 4);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    const a = bytes[j + 3];
    out[i] = a === 0 ? 0 : (((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | a) >>> 0);
  }
  return out;
}

export function composite(doc: Doc, opts: CompositeOptions = {}): Uint8ClampedArray {
  return packedToBytes(compositePacked(doc, opts));
}

/* ---------------------------- serialization ---------------------------- */

export interface SerializedLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  /** base64 of RGBA bytes, one per frame */
  cels: string[];
}

export interface SerializedDoc {
  format: 'openpixel';
  version: 1;
  name: string;
  width: number;
  height: number;
  layers: SerializedLayer[];
  frames: Frame[];
  palette: string[];
  activeLayerId: string;
  activeFrame: number;
}

function bytesToBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serializeDoc(doc: Doc): SerializedDoc {
  return {
    format: 'openpixel',
    version: 1,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      cels: l.cels.map((c) => bytesToBase64(packedToBytes(c))),
    })),
    frames: doc.frames.map((f) => ({ ...f })),
    palette: [...doc.palette],
    activeLayerId: doc.activeLayerId,
    activeFrame: doc.activeFrame,
  };
}

export function deserializeDoc(data: SerializedDoc): Doc {
  if (!data || data.format !== 'openpixel') throw new Error('Archivo no es un documento openPixel');
  checkSize(data.width, data.height);
  const n = data.width * data.height;
  const frames = data.frames?.length ? data.frames.map((f) => ({ id: f.id || makeId('frame'), duration: f.duration || 100 })) : [{ id: makeId('frame'), duration: 100 }];
  const layers: Layer[] = data.layers.map((l) => ({
    id: l.id,
    name: l.name,
    visible: l.visible !== false,
    opacity: typeof l.opacity === 'number' ? l.opacity : 1,
    locked: !!l.locked,
    cels: frames.map((_, i) => {
      const b64 = l.cels[i];
      if (!b64) return new Uint32Array(n);
      const packed = bytesToPacked(base64ToBytes(b64));
      if (packed.length !== n) throw new Error(`Capa "${l.name}" tiene tamaño incorrecto`);
      return packed;
    }),
  }));
  if (!layers.length) layers.push(createLayer(data.width, data.height, frames.length, 'Capa 1'));
  return {
    name: data.name || 'Sin título',
    width: data.width,
    height: data.height,
    layers,
    frames,
    palette: data.palette?.length ? [...data.palette] : [...DEFAULT_PALETTE],
    activeLayerId: layers.some((l) => l.id === data.activeLayerId) ? data.activeLayerId : layers[layers.length - 1].id,
    activeFrame: Math.min(Math.max(0, data.activeFrame | 0), frames.length - 1),
  };
}
