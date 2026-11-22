import {
  bytesToPacked,
  compositePacked,
  createDoc,
  encodeGif,
  packedToBytes,
  parseColor,
  serializeDoc,
  toHex,
  type Doc,
  type Op,
} from '@openpixel/core';
import { regionTester } from '@openpixel/core';
import { getState, redo, selectionClip, sendOps, setState, swapColors, toast, undo, type ToolId } from './store';
import { isTyping, viewportApi } from './components/Viewport';

export function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (doc: Doc) => (doc.name || 'openpixel').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim() || 'openpixel';

export function newCanvas(width: number, height: number, background: string | null, name?: string) {
  const doc = getState().doc;
  const fresh = createDoc(width, height, { background: background ? parseColor(background) : 0, name, palette: doc?.palette });
  sendOps([{ type: 'load', doc: serializeDoc(fresh) }]);
}

export function saveProject() {
  const doc = getState().doc;
  if (!doc) return;
  download(`${safeName(doc)}.opx`, new Blob([JSON.stringify(serializeDoc(doc))], { type: 'application/json' }));
}

function frameCanvas(doc: Doc, frame: number, scale: number) {
  const src = document.createElement('canvas');
  src.width = doc.width;
  src.height = doc.height;
  src.getContext('2d')!.putImageData(new ImageData(packedToBytes(compositePacked(doc, { frame })) as Uint8ClampedArray<ArrayBuffer>, doc.width, doc.height), 0, 0);
  if (scale === 1) return src;
  const out = document.createElement('canvas');
  out.width = doc.width * scale;
  out.height = doc.height * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png'));

export async function exportPng(scale: number) {
  const doc = getState().doc;
  if (!doc) return;
  download(`${safeName(doc)}${doc.frames.length > 1 ? `-frame${doc.activeFrame + 1}` : ''}.png`, await toBlob(frameCanvas(doc, doc.activeFrame, scale)));
}

export async function exportSpritesheet(scale: number) {
  const doc = getState().doc;
  if (!doc) return;
  const out = document.createElement('canvas');
  out.width = doc.width * scale * doc.frames.length;
  out.height = doc.height * scale;
  const ctx = out.getContext('2d')!;
  doc.frames.forEach((_, i) => ctx.drawImage(frameCanvas(doc, i, scale), i * doc.width * scale, 0));
  download(`${safeName(doc)}-spritesheet.png`, await toBlob(out));
}

export function exportGif(scale: number) {
  const doc = getState().doc;
  if (!doc) return;
  const frames = doc.frames.map((f, i) => ({ pixels: compositePacked(doc, { frame: i }), delay: f.duration }));
  const bytes = encodeGif(doc.width, doc.height, frames, { scale });
  download(`${safeName(doc)}.gif`, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' }));
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((ok) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => ok(input.files?.[0] ?? null);
    input.click();
  });
}

export async function openFile() {
  const file = await pickFile('.opx,.json,image/png,image/gif,image/jpeg,image/webp');
  if (!file) return;
  if (/\.(opx|json)$/i.test(file.name)) {
    try {
      const data = JSON.parse(await file.text());
      sendOps([{ type: 'load', doc: data }]);
    } catch (e) {
      toast(`No se pudo abrir: ${(e as Error).message}`, 'error');
    }
  } else {
    await importImage(file, true);
  }
}

/** Import an image into a new layer. With `asNew`, creates a document of the image size. */
export async function importImage(file?: File | null, asNew = false) {
  file ??= await pickFile('image/*');
  if (!file) return;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return toast('No se pudo leer la imagen', 'error');
  if (bmp.width > 1024 || bmp.height > 1024) return toast('La imagen es demasiado grande (máx. 1024×1024)', 'error');
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const packed = bytesToPacked(ctx.getImageData(0, 0, bmp.width, bmp.height).data);
  const pixels = Array.from(packed, (p) => toHex(p));
  const name = file.name.replace(/\.[^.]+$/, '');
  const ops: Op[] = [];
  const doc = getState().doc;
  if (asNew || !doc) {
    const fresh = createDoc(bmp.width, bmp.height, { name, palette: doc?.palette });
    ops.push({ type: 'load', doc: serializeDoc(fresh) });
    ops.push({ type: 'updateLayer', name });
  } else {
    if (bmp.width > doc.width || bmp.height > doc.height) {
      ops.push({ type: 'resize', width: Math.max(doc.width, bmp.width), height: Math.max(doc.height, bmp.height) });
    }
    ops.push({ type: 'addLayer', name });
  }
  ops.push({ type: 'paste', x: 0, y: 0, width: bmp.width, height: bmp.height, pixels });
  sendOps(ops);
}

/* ------------------------- selection clipboard ------------------------ */

let clipboard: { w: number; h: number; pixels: (string | null)[]; mask?: Uint8Array } | null = null;

export function copySelection(cut = false) {
  const s = getState();
  const doc = s.doc;
  if (!doc) return;
  const sel = s.selection ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  const inside = regionTester(sel);
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
  const cel = layer.cels[doc.activeFrame];
  const pixels: (string | null)[] = [];
  for (let y = sel.y; y < sel.y + sel.h; y++) for (let x = sel.x; x < sel.x + sel.w; x++) {
    const ok = inside(x, y) && x >= 0 && y >= 0 && x < doc.width && y < doc.height;
    pixels.push(ok ? toHex(cel[y * doc.width + x]) : null);
  }
  clipboard = { w: sel.w, h: sel.h, pixels, mask: sel.mask };
  if (cut) sendOps([{ type: 'clear', clip: selectionClip() }]);
  toast(cut ? 'Cortado' : 'Copiado');
}

export function pasteClipboard() {
  const s = getState();
  if (!clipboard || !s.doc) return;
  const x = s.selection?.x ?? 0, y = s.selection?.y ?? 0;
  sendOps([{ type: 'paste', x, y, width: clipboard.w, height: clipboard.h, pixels: clipboard.pixels, skipTransparent: true }]);
  setState({ selection: { x, y, w: clipboard.w, h: clipboard.h, mask: clipboard.mask }, tool: 'select' });
}

export function deleteSelection() {
  const s = getState();
  if (!s.doc) return;
  sendOps([{ type: 'clear', clip: selectionClip() }]);
}

export function commitText() {
  const s = getState();
  const d = s.textDraft;
  if (!d || !d.text.trim()) return;
  sendOps([{
    type: 'text', x: d.x, y: d.y, text: d.text, color: s.primary, font: s.textFont, scale: s.textScale,
    outline: s.textOutline ? s.secondary : undefined, shadow: s.textShadow ? s.secondary : undefined, clip: selectionClip(),
  }]);
  setState({ textDraft: null });
}

/* ----------------------------- shortcuts ------------------------------ */

const TOOL_KEYS: Record<string, ToolId> = {
  b: 'pencil', e: 'eraser', g: 'bucket', i: 'picker', l: 'line', u: 'rect', o: 'ellipse',
  m: 'select', q: 'lasso', w: 'wand', t: 'text', v: 'move', d: 'dither', s: 'shade', h: 'pan',
};

export function installShortcuts() {
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e) || getState().dialog) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
      else if (k === 's') { e.preventDefault(); saveProject(); }
      else if (k === 'o') { e.preventDefault(); openFile(); }
      else if (k === 'c') { e.preventDefault(); copySelection(); }
      else if (k === 'x') { e.preventDefault(); copySelection(true); }
      else if (k === 'v') { e.preventDefault(); pasteClipboard(); }
      else if (k === 'a') { e.preventDefault(); const d = getState().doc; if (d) setState({ selection: { x: 0, y: 0, w: d.width, h: d.height }, tool: 'select' }); }
      else if (k === 'd') { e.preventDefault(); setState({ selection: null }); }
      return;
    }
    if (TOOL_KEYS[k]) { setState({ tool: TOOL_KEYS[k] }); return; }
    switch (e.key) {
      case 'x': case 'X': swapColors(); break;
      case '[': setState((s) => ({ brushSize: Math.max(1, s.brushSize - 1) })); break;
      case ']': setState((s) => ({ brushSize: Math.min(32, s.brushSize + 1) })); break;
      case '+': case '=': viewportApi.zoomBy(1); break;
      case '-': case '_': viewportApi.zoomBy(-1); break;
      case '0': viewportApi.fit(); break;
      case '#': setState((s) => ({ showGrid: !s.showGrid })); break;
      case 'Delete': case 'Backspace': deleteSelection(); break;
      case 'Escape': setState({ selection: null, textDraft: null }); break;
      case 'Enter': if (getState().textDraft) commitText(); break;
      case ',': stepFrame(-1); break;
      case '.': stepFrame(1); break;
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

export function stepFrame(dir: number) {
  const doc = getState().doc;
  if (!doc || doc.frames.length < 2) return;
  const f = (doc.activeFrame + dir + doc.frames.length) % doc.frames.length;
  sendOps([{ type: 'select', frame: f }]);
}
