import { useEffect, useRef } from 'react';
import {
  activeLayer,
  brush,
  combineRegions,
  compositePacked,
  ellipse,
  floodIndices,
  layoutText,
  line,
  polygonRegion,
  regionFromIndices,
  regionOutline,
  regionTester,
  packedToBytes,
  parseColor,
  rect,
  rectFromCorners,
  roundBrush,
  toHex,
  type Doc,
  type Op,
} from '@openpixel/core';
import { getState, newGroup, selectionClip, sendOps, setState, subscribe, toast, useStore, type Selection } from '../store';

export const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128];

type Pt = { x: number; y: number };
type SelMode = 'replace' | 'add' | 'subtract';

const outlineCache = new WeakMap<Selection, [number, number, number, number][]>();
function outlineOf(sel: Selection) {
  let o = outlineCache.get(sel);
  if (!o) { o = regionOutline(sel); outlineCache.set(sel, o); }
  return o;
}

function applySel(mode: SelMode, region: Selection | null) {
  const cur = getState().selection;
  const next = mode === 'replace' ? region : combineRegions(cur, region, mode);
  setState({ selection: next });
}

type Interaction =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'stroke'; group: string; color: string | null; last: Pt; queue: number[]; dither: boolean }
  | { kind: 'shade'; points: number[]; last: Pt; amount: number }
  | { kind: 'shape'; tool: 'line' | 'rect' | 'ellipse'; start: Pt; end: Pt; color: string | null }
  | { kind: 'select'; start: Pt; end: Pt; mode: SelMode }
  | { kind: 'lasso'; points: Pt[]; mode: SelMode }
  | { kind: 'moveSel'; start: Pt; end: Pt; sel: Selection; copy: boolean }
  | { kind: 'moveLayer'; start: Pt; end: Pt };

/** Public handle so the top bar can trigger zoom/fit. */
export const viewportApi = {
  zoomBy: (_dir: number) => {},
  fit: () => {},
};

export function Viewport() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ zoom: getState().zoom, panX: 0, panY: 0, w: 0, h: 0 });
  const docCanvas = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const onionCanvas = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const cacheKey = useRef('');
  const inter = useRef<Interaction | null>(null);
  const spaceDown = useRef(false);
  const dirty = useRef(true);
  const lastDocSize = useRef('');
  const tool = useStore((s) => s.tool);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const requestDraw = () => {
      dirty.current = true;
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const toDocF = (cx: number, cy: number): Pt => {
      const r = canvas.getBoundingClientRect();
      const v = view.current;
      return { x: (cx - r.left - v.panX) / v.zoom, y: (cy - r.top - v.panY) / v.zoom };
    };
    const toDoc = (cx: number, cy: number): Pt => {
      const p = toDocF(cx, cy);
      return { x: Math.floor(p.x), y: Math.floor(p.y) };
    };

    const setZoom = (z: number, cx?: number, cy?: number) => {
      const v = view.current;
      const ax = cx ?? v.w / 2, ay = cy ?? v.h / 2;
      const dx = (ax - v.panX) / v.zoom, dy = (ay - v.panY) / v.zoom;
      v.zoom = z;
      v.panX = Math.round(ax - dx * z);
      v.panY = Math.round(ay - dy * z);
      setState({ zoom: z });
      requestDraw();
    };

    const fit = () => {
      const doc = getState().doc;
      if (!doc) return;
      const v = view.current;
      const maxZ = Math.min((v.w * 0.9) / doc.width, (v.h * 0.9) / doc.height);
      const z = [...ZOOMS].reverse().find((zz) => zz <= maxZ) ?? ZOOMS[0];
      v.zoom = z;
      v.panX = Math.round((v.w - doc.width * z) / 2);
      v.panY = Math.round((v.h - doc.height * z) / 2);
      setState({ zoom: z });
      requestDraw();
    };

    const zoomBy = (dir: number, cx?: number, cy?: number) => {
      const z = view.current.zoom;
      const i = ZOOMS.findIndex((zz) => zz >= z - 1e-6);
      const ni = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + dir));
      setZoom(ZOOMS[ni], cx, cy);
    };
    viewportApi.zoomBy = (d) => zoomBy(d);
    viewportApi.fit = fit;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      view.current.w = r.width;
      view.current.h = r.height;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      requestDraw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    /* -------------------------- rendering -------------------------- */

    const updateDocCanvas = (doc: Doc) => {
      const s = getState();
      const key = `${s.version}:${doc.activeFrame}:${s.onionSkin}`;
      if (key === cacheKey.current) return;
      cacheKey.current = key;
      const dc = docCanvas.current;
      if (dc.width !== doc.width || dc.height !== doc.height) { dc.width = doc.width; dc.height = doc.height; }
      const img = new ImageData(packedToBytes(compositePacked(doc)) as Uint8ClampedArray<ArrayBuffer>, doc.width, doc.height);
      dc.getContext('2d')!.putImageData(img, 0, 0);
      const oc = onionCanvas.current;
      if (s.onionSkin && doc.activeFrame > 0) {
        if (oc.width !== doc.width || oc.height !== doc.height) { oc.width = doc.width; oc.height = doc.height; }
        const prev = new ImageData(packedToBytes(compositePacked(doc, { frame: doc.activeFrame - 1 })) as Uint8ClampedArray<ArrayBuffer>, doc.width, doc.height);
        oc.getContext('2d')!.putImageData(prev, 0, 0);
      }
    };

    const previewPixels = (): { pts: number[]; color: string } | null => {
      const it = inter.current;
      const s = getState();
      const doc = s.doc;
      if (!doc || !it) return null;
      if (it.kind !== 'shape') return null;
      const pts: number[] = [];
      const push = (x: number, y: number) => {
        if (x >= 0 && y >= 0 && x < doc.width && y < doc.height) pts.push(x, y);
      };
      const put = mirrorPlot(doc, s.mirror, push);
      const { start: a, end: b } = it;
      if (it.tool === 'line') line(a.x, a.y, b.x, b.y, (x, y) => brush(x, y, s.brushSize, put));
      else {
        const r = rectFromCorners(a.x, a.y, b.x, b.y);
        if (it.tool === 'rect') rect(r.x, r.y, r.w, r.h, s.shapeFilled, put, s.shapeFilled ? 1 : s.brushSize);
        else ellipse(r.x, r.y, r.w, r.h, s.shapeFilled, put);
      }
      return { pts, color: it.color ?? 'erase' };
    };

    function frame() {
      raf = 0;
      if (!dirty.current) return;
      dirty.current = false;
      const s = getState();
      const doc = s.doc;
      const v = view.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--canvas-bg') || '#16161f';
      ctx.fillRect(0, 0, v.w, v.h);
      if (!doc) return;

      const sizeKey = `${doc.width}x${doc.height}`;
      if (sizeKey !== lastDocSize.current) {
        lastDocSize.current = sizeKey;
        fit();
        return;
      }
      updateDocCanvas(doc);
      const z = v.zoom;
      const W = doc.width * z, H = doc.height * z;
      const ox = v.panX, oy = v.panY;

      // checkerboard
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, W, H);
      ctx.clip();
      const cs = Math.max(4, Math.min(16, z / 2 >= 4 ? z / 2 : 8));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ox, oy, W, H);
      ctx.fillStyle = '#dcdce4';
      const x0 = Math.max(ox, 0), y0 = Math.max(oy, 0), x1 = Math.min(ox + W, v.w), y1 = Math.min(oy + H, v.h);
      for (let yy = y0 - ((y0 - oy) % (cs * 2)); yy < y1; yy += cs) {
        for (let xx = x0 - ((x0 - ox) % (cs * 2)); xx < x1; xx += cs) {
          if (((Math.floor((xx - ox) / cs) + Math.floor((yy - oy) / cs)) & 1) === 1) ctx.fillRect(xx, yy, cs, cs);
        }
      }
      ctx.imageSmoothingEnabled = false;
      if (s.onionSkin && doc.activeFrame > 0) {
        ctx.globalAlpha = 0.3;
        ctx.drawImage(onionCanvas.current, ox, oy, W, H);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(docCanvas.current, ox, oy, W, H);

      // floating previews
      const it = inter.current;
      const pv = previewPixels();
      if (pv) {
        ctx.fillStyle = pv.color === 'erase' ? 'rgba(255,255,255,0.85)' : pv.color;
        for (let i = 0; i < pv.pts.length; i += 2) ctx.fillRect(ox + pv.pts[i] * z, oy + pv.pts[i + 1] * z, z, z);
      }
      if (it && (it.kind === 'moveSel' || it.kind === 'moveLayer')) {
        const layer = activeLayer(doc);
        const cel = layer.cels[doc.activeFrame];
        const dx = it.end.x - it.start.x, dy = it.end.y - it.start.y;
        const area = it.kind === 'moveSel' ? it.sel : { x: 0, y: 0, w: doc.width, h: doc.height };
        const inArea = regionTester(area);
        ctx.globalAlpha = 0.85;
        for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) {
          if (x < 0 || y < 0 || x >= doc.width || y >= doc.height || !inArea(x, y)) continue;
          const c = cel[y * doc.width + x];
          if (!c) continue;
          ctx.fillStyle = toHex(c)!;
          ctx.fillRect(ox + (x + dx) * z, oy + (y + dy) * z, z, z);
        }
        ctx.globalAlpha = 1;
      }
      if (s.textDraft && s.tool === 'text') {
        const d = s.textDraft;
        const lay = layoutText(d.text || ' ', { font: s.textFont, scale: s.textScale });
        const sc = s.textScale;
        const paint = (color: string, offs: [number, number][]) => {
          ctx.fillStyle = color;
          for (const [px, py] of lay.pixels) for (const [ix, iy] of offs) ctx.fillRect(ox + (d.x + px + ix) * z, oy + (d.y + py + iy) * z, z, z);
        };
        if (s.textShadow) paint(s.secondary, [[sc, sc]]);
        if (s.textOutline) paint(s.secondary, [[-sc, -sc], [0, -sc], [sc, -sc], [-sc, 0], [sc, 0], [-sc, sc], [0, sc], [sc, sc]]);
        paint(s.primary, [[0, 0]]);
        // caret / box
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#6c8cff';
        ctx.strokeRect(ox + d.x * z - 1.5, oy + d.y * z - 1.5, Math.max(lay.width, 1) * z + 3, Math.max(lay.height, 1) * z + 3);
        ctx.setLineDash([]);
      }
      ctx.restore();

      // grid
      if (s.showGrid && z >= 6) {
        ctx.beginPath();
        for (let x = 0; x <= doc.width; x++) {
          const px = Math.round(ox + x * z) + 0.5;
          if (px < -1 || px > v.w + 1) continue;
          ctx.moveTo(px, oy); ctx.lineTo(px, oy + H);
        }
        for (let y = 0; y <= doc.height; y++) {
          const py = Math.round(oy + y * z) + 0.5;
          if (py < -1 || py > v.h + 1) continue;
          ctx.moveTo(ox, py); ctx.lineTo(ox + W, py);
        }
        ctx.strokeStyle = 'rgba(40,40,80,0.24)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (doc.width >= 16 || doc.height >= 16) {
          ctx.beginPath();
          for (let x = 8; x < doc.width; x += 8) { const px = Math.round(ox + x * z) + 0.5; ctx.moveTo(px, oy); ctx.lineTo(px, oy + H); }
          for (let y = 8; y < doc.height; y += 8) { const py = Math.round(oy + y * z) + 0.5; ctx.moveTo(ox, py); ctx.lineTo(ox + W, py); }
          ctx.strokeStyle = 'rgba(40,40,120,0.28)';
          ctx.stroke();
        }
      }

      // mirror axes
      if (s.mirror !== 'none') {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(255,107,91,0.8)';
        ctx.beginPath();
        if (s.mirror === 'x' || s.mirror === 'xy') { ctx.moveTo(ox + W / 2, oy); ctx.lineTo(ox + W / 2, oy + H); }
        if (s.mirror === 'y' || s.mirror === 'xy') { ctx.moveTo(ox, oy + H / 2); ctx.lineTo(ox + W, oy + H / 2); }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // border
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeRect(ox - 0.5, oy - 0.5, W + 1, H + 1);

      // selection marquee
      const t = (performance.now() / 60) % 16;
      const ants = (path: () => void) => {
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        for (const [color, off] of [['#000', 0], ['#fff', 4]] as const) {
          ctx.beginPath();
          path();
          ctx.strokeStyle = color;
          ctx.lineDashOffset = -t + off;
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        dirty.current = true; // animate marching ants
      };
      let sel: Selection | null = s.selection;
      let dx = 0, dy = 0;
      if (it?.kind === 'moveSel') { sel = it.sel; dx = it.end.x - it.start.x; dy = it.end.y - it.start.y; }
      if (sel) {
        const segs = outlineOf(sel);
        const snap = (v: number, o: number) => Math.round(o + v * z) + 0.5;
        ants(() => {
          for (const [x1, y1, x2, y2] of segs) {
            ctx.moveTo(snap(x1 + dx, ox), snap(y1 + dy, oy));
            ctx.lineTo(snap(x2 + dx, ox), snap(y2 + dy, oy));
          }
        });
      }
      if (it?.kind === 'select') {
        const r = rectFromCorners(it.start.x, it.start.y, it.end.x, it.end.y);
        ants(() => ctx.rect(ox + r.x * z + 0.5, oy + r.y * z + 0.5, r.w * z - 1, r.h * z - 1));
      }
      if (it?.kind === 'lasso' && it.points.length > 1) {
        ants(() => {
          it.points.forEach((p, i) => (i ? ctx.lineTo(ox + p.x * z, oy + p.y * z) : ctx.moveTo(ox + p.x * z, oy + p.y * z)));
          ctx.closePath();
        });
      }

      // Claude activity highlight
      if (s.claude?.bounds) {
        const age = Date.now() - s.claude.at;
        if (age < 1600) {
          const b = s.claude.bounds;
          ctx.globalAlpha = 1 - age / 1600;
          ctx.strokeStyle = '#d97757';
          ctx.lineWidth = 2;
          ctx.strokeRect(ox + b.x * z - 2, oy + b.y * z - 2, b.w * z + 4, b.h * z + 4);
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
          dirty.current = true;
        }
      }

      // brush cursor
      if (s.cursor && !it && ['pencil', 'eraser', 'dither', 'shade', 'line', 'rect', 'ellipse'].includes(s.tool)) {
        const size = s.tool === 'rect' || s.tool === 'ellipse' ? 1 : s.brushSize;
        const pts: number[] = [];
        (s.brushShape === 'round' ? roundBrush : brush)(s.cursor.x, s.cursor.y, size, (x, y) => pts.push(x, y));
        ctx.fillStyle = s.tool === 'eraser' ? 'rgba(255,255,255,0.5)' : hexWithAlpha(s.primary, 0.55);
        for (let i = 0; i < pts.length; i += 2) ctx.fillRect(ox + pts[i] * z, oy + pts[i + 1] * z, z, z);
        const off = Math.floor((size - 1) / 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeRect(ox + (s.cursor.x - off) * z + 0.5, oy + (s.cursor.y - off) * z + 0.5, size * z - 1, size * z - 1);
      }

      if (dirty.current && !raf) raf = requestAnimationFrame(frame);
    }

    const unsub = subscribe(requestDraw);

    /* --------------------------- input --------------------------- */

    const colorFor = (button: number): string | null => {
      const s = getState();
      return button === 2 ? s.secondary : s.primary;
    };

    const flushStroke = () => {
      const it = inter.current;
      if (!it || it.kind !== 'stroke' || !it.queue.length) return;
      const s = getState();
      sendOps([{
        type: 'plot',
        points: it.queue,
        color: it.color,
        size: s.brushSize,
        shape: s.brushShape,
        mirror: s.mirror,
        dither: it.dither ? 'checker' : undefined,
        clip: clip(),
      }], it.group);
      it.queue = [it.last.x, it.last.y];
    };
    let flushTimer = 0;
    const scheduleFlush = () => {
      if (!flushTimer) flushTimer = window.setTimeout(() => { flushTimer = 0; flushStroke(); }, 16);
    };

    const pick = (p: Pt, button: number) => {
      const doc = getState().doc;
      if (!doc || p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
      const c = compositePacked(doc)[p.y * doc.width + p.x];
      const hex = toHex(c);
      if (!hex) return;
      setState(button === 2 ? { secondary: hex } : { primary: hex });
    };

    const inSel = (p: Pt) => {
      const sel = getState().selection;
      return !!sel && regionTester(sel)(p.x, p.y);
    };
    const selMode = (e: PointerEvent): SelMode => (e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'subtract' : 'replace');
    const clip = () => selectionClip();

    const onDown = (e: PointerEvent) => {
      const s = getState();
      if (!s.doc) return;
      canvas.setPointerCapture(e.pointerId);
      const p = toDoc(e.clientX, e.clientY);
      const v = view.current;
      if (e.button === 1 || spaceDown.current || s.tool === 'pan') {
        inter.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: v.panX, py: v.panY };
        return;
      }
      if (e.button !== 0 && e.button !== 2) return;
      const layer = activeLayer(s.doc);
      const drawing = !['picker', 'select', 'lasso', 'wand', 'pan'].includes(s.tool);
      if (drawing && (layer.locked || !layer.visible)) {
        toast(layer.locked ? `La capa "${layer.name}" está bloqueada` : `La capa "${layer.name}" está oculta`, 'error');
        return;
      }
      if (e.altKey && !['select', 'lasso', 'wand'].includes(s.tool)) return pick(p, e.button);
      switch (s.tool) {
        case 'pencil':
        case 'eraser':
        case 'dither': {
          const color = s.tool === 'eraser' ? null : colorFor(e.button);
          inter.current = { kind: 'stroke', group: newGroup(), color, last: p, queue: [p.x, p.y], dither: s.tool === 'dither' };
          flushStroke();
          break;
        }
        case 'shade':
          inter.current = { kind: 'shade', points: [p.x, p.y], last: p, amount: e.button === 2 ? -s.shadeAmount : s.shadeAmount };
          break;
        case 'bucket':
          sendOps([{ type: 'fill', x: p.x, y: p.y, color: colorFor(e.button), contiguous: s.fillContiguous, clip: clip() }]);
          break;
        case 'picker':
          pick(p, e.button);
          break;
        case 'line':
        case 'rect':
        case 'ellipse':
          inter.current = { kind: 'shape', tool: s.tool, start: p, end: p, color: colorFor(e.button) };
          break;
        case 'select':
        case 'lasso':
        case 'wand': {
          const mode = selMode(e);
          if (mode === 'replace' && inSel(p)) {
            inter.current = { kind: 'moveSel', start: p, end: p, sel: s.selection!, copy: e.altKey };
            break;
          }
          if (s.tool === 'select') inter.current = { kind: 'select', start: p, end: p, mode };
          else if (s.tool === 'lasso') inter.current = { kind: 'lasso', points: [toDocF(e.clientX, e.clientY)], mode };
          else {
            const doc = s.doc;
            if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) { if (mode === 'replace') setState({ selection: null }); break; }
            const cel = activeLayer(doc).cels[doc.activeFrame];
            applySel(mode, regionFromIndices(floodIndices(cel, doc.width, doc.height, p.x, p.y, s.wandContiguous), doc.width));
          }
          break;
        }
        case 'text': {
          const keep = s.textDraft?.text ?? '';
          setState({ textDraft: { x: p.x, y: p.y, text: keep } });
          break;
        }
        case 'move':
          inter.current = { kind: 'moveLayer', start: p, end: p };
          break;
      }
      requestDraw();
    };

    const constrain = (a: Pt, b: Pt, tool: string): Pt => {
      const dx = b.x - a.x, dy = b.y - a.y;
      if (tool === 'line') {
        const adx = Math.abs(dx), ady = Math.abs(dy);
        if (adx > ady * 2) return { x: b.x, y: a.y };
        if (ady > adx * 2) return { x: a.x, y: b.y };
        const d = Math.max(adx, ady);
        return { x: a.x + Math.sign(dx) * d, y: a.y + Math.sign(dy) * d };
      }
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: a.x + (dx < 0 ? -d : d), y: a.y + (dy < 0 ? -d : d) };
    };

    const onMove = (e: PointerEvent) => {
      const p = toDoc(e.clientX, e.clientY);
      const s = getState();
      if (!s.cursor || s.cursor.x !== p.x || s.cursor.y !== p.y) setState({ cursor: p });
      const it = inter.current;
      if (!it) return;
      switch (it.kind) {
        case 'pan': {
          const v = view.current;
          v.panX = it.px + e.clientX - it.sx;
          v.panY = it.py + e.clientY - it.sy;
          requestDraw();
          break;
        }
        case 'stroke':
          if (p.x !== it.last.x || p.y !== it.last.y) {
            it.queue.push(p.x, p.y);
            it.last = p;
            scheduleFlush();
          }
          break;
        case 'shade':
          if (p.x !== it.last.x || p.y !== it.last.y) {
            it.points.push(p.x, p.y);
            it.last = p;
          }
          break;
        case 'shape':
          it.end = e.shiftKey ? constrain(it.start, p, it.tool) : p;
          requestDraw();
          break;
        case 'select':
          it.end = p;
          requestDraw();
          break;
        case 'lasso': {
          const f = toDocF(e.clientX, e.clientY);
          const last = it.points[it.points.length - 1];
          if (Math.hypot(f.x - last.x, f.y - last.y) >= 0.35) it.points.push(f);
          requestDraw();
          break;
        }
        case 'moveSel':
        case 'moveLayer':
          it.end = p;
          requestDraw();
          break;
      }
    };

    const onUp = () => {
      const it = inter.current;
      if (!it) return;
      const s = getState();
      const doc = s.doc;
      inter.current = null;
      if (!doc) return;
      const ops: Op[] = [];
      switch (it.kind) {
        case 'stroke':
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
          inter.current = it;
          flushStroke();
          inter.current = null;
          break;
        case 'shade':
          ops.push({ type: 'shade', points: it.points, amount: it.amount, size: s.brushSize, shape: s.brushShape, mirror: s.mirror, clip: clip() });
          break;
        case 'shape': {
          const { start: a, end: b } = it;
          if (it.tool === 'line') ops.push({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: it.color, size: s.brushSize, mirror: s.mirror, clip: clip() });
          else {
            const r = rectFromCorners(a.x, a.y, b.x, b.y);
            if (it.tool === 'rect') ops.push({ type: 'rect', ...r, color: it.color, filled: s.shapeFilled, thickness: s.brushSize, mirror: s.mirror, clip: clip() });
            else ops.push({ type: 'ellipse', ...r, color: it.color, filled: s.shapeFilled, mirror: s.mirror, clip: clip() });
          }
          break;
        }
        case 'select': {
          const r = clampRect(rectFromCorners(it.start.x, it.start.y, it.end.x, it.end.y), doc);
          const tiny = !r || (r.w <= 1 && r.h <= 1);
          if (it.mode === 'replace') setState({ selection: tiny ? null : r });
          else if (!tiny) applySel(it.mode, r);
          break;
        }
        case 'lasso': {
          const region = it.points.length > 2 ? polygonRegion(it.points, doc.width, doc.height) : null;
          if (it.mode === 'replace') setState({ selection: region });
          else applySel(it.mode, region);
          break;
        }
        case 'moveSel': {
          const dx = it.end.x - it.start.x, dy = it.end.y - it.start.y;
          if (dx || dy) {
            const r = selectionClip()!;
            ops.push({ type: 'moveRegion', x: r.x, y: r.y, w: r.w, h: r.h, mask: r.mask, dx, dy, copy: it.copy });
            setState({ selection: { ...it.sel, x: it.sel.x + dx, y: it.sel.y + dy } });
          }
          break;
        }
        case 'moveLayer': {
          const dx = it.end.x - it.start.x, dy = it.end.y - it.start.y;
          if (dx || dy) ops.push({ type: 'shift', dx, dy });
          break;
        }
      }
      if (ops.length) sendOps(ops);
      requestDraw();
    };

    const onLeave = () => setState({ cursor: null });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
      } else {
        view.current.panX -= e.deltaX;
        requestDraw();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        spaceDown.current = e.type === 'keydown';
        canvas.style.cursor = spaceDown.current ? 'grab' : '';
        if (e.type === 'keydown') e.preventDefault();
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    return () => {
      ro.disconnect();
      unsub();
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const cursor = tool === 'pan' ? 'grab' : tool === 'move' ? 'move' : tool === 'picker' ? 'copy' : tool === 'text' ? 'text' : 'crosshair';
  return (
    <div className="viewport" ref={wrapRef}>
      <canvas ref={canvasRef} style={{ cursor }} />
    </div>
  );
}

function mirrorPlot(doc: Doc, mirror: string, plot: (x: number, y: number) => void) {
  if (mirror === 'none') return plot;
  const W = doc.width - 1, H = doc.height - 1;
  return (x: number, y: number) => {
    plot(x, y);
    if (mirror === 'x' || mirror === 'xy') plot(W - x, y);
    if (mirror === 'y' || mirror === 'xy') plot(x, H - y);
    if (mirror === 'xy') plot(W - x, H - y);
  };
}

function clampRect(r: Selection, doc: Doc): Selection | null {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  const x1 = Math.min(doc.width, r.x + r.w), y1 = Math.min(doc.height, r.y + r.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function hexWithAlpha(hex: string, a: number) {
  try {
    const c = parseColor(hex);
    return `rgba(${c >>> 24},${(c >>> 16) & 255},${(c >>> 8) & 255},${a})`;
  } catch {
    return `rgba(0,0,0,${a})`;
  }
}

export function isTyping(e: Event) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
