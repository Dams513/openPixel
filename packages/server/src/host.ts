import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { homedir } from 'node:os';
import type { WebSocket } from 'ws';
import {
  createDoc,
  deserializeDoc,
  describeDoc,
  Engine,
  findFrameIndex,
  findLayer,
  makeId,
  parseColor,
  regionToText,
  serializeDoc,
  type ApplyResult,
  type Bounds,
  type ClientKind,
  type ClientMessage,
  type Op,
  type PresenceClient,
  type SerializedDoc,
  type ServerMessage,
  type TextRegionOptions,
  encodeGif,
  compositePacked,
} from '@openpixel/core';
import { autoScale, renderPng, renderSheetPng, type RenderOptions } from './png';

export const log = (...a: unknown[]) => console.error('[openpixel]', ...a);

interface Client {
  id: string;
  name: string;
  kind: ClientKind;
  ws: WebSocket;
}

export interface ImageOptions {
  scale?: number;
  grid?: boolean;
  frame?: number | string;
  layer?: number | string;
  region?: { x: number; y: number; w: number; h: number };
}

export function dataHome() {
  return process.env.OPENPIXEL_HOME || resolve(homedir(), '.openpixel');
}

export class Host {
  engine: Engine;
  clients = new Map<string, Client>();
  private saveTimer: NodeJS.Timeout | null = null;
  readonly autosavePath: string;

  constructor(opts: { autosavePath?: string } = {}) {
    this.autosavePath = opts.autosavePath ?? resolve(dataHome(), 'autosave.opx');
    this.engine = new Engine(this.loadAutosave() ?? createDoc(32, 32));
  }

  get doc() {
    return this.engine.doc;
  }

  private loadAutosave() {
    try {
      if (existsSync(this.autosavePath)) {
        const doc = deserializeDoc(JSON.parse(readFileSync(this.autosavePath, 'utf8')));
        log(`documento restaurado de ${this.autosavePath}`);
        return doc;
      }
    } catch (e) {
      log('no se pudo leer el autoguardado:', (e as Error).message);
    }
    return null;
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 800);
  }

  flushSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      mkdirSync(dirname(this.autosavePath), { recursive: true });
      const tmp = this.autosavePath + '.tmp';
      writeFileSync(tmp, JSON.stringify(serializeDoc(this.doc)));
      renameSync(tmp, this.autosavePath);
    } catch (e) {
      log('error al autoguardar:', (e as Error).message);
    }
  }

  /* ------------------------------ clients ------------------------------ */

  private history() {
    return { canUndo: this.engine.canUndo(), canRedo: this.engine.canRedo() };
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) if (c.ws.readyState === 1) c.ws.send(data);
  }

  private broadcastPresence() {
    const clients: PresenceClient[] = [...this.clients.values()].map(({ id, name, kind }) => ({ id, name, kind }));
    this.broadcast({ t: 'presence', clients });
  }

  /** Editors connected through WebSocket. */
  editorCount() {
    return this.clients.size;
  }

  attach(ws: WebSocket) {
    const client: Client = { id: makeId('c'), name: 'Editor', kind: 'editor', ws };
    this.clients.set(client.id, client);
    this.send(ws, { t: 'welcome', clientId: client.id, doc: serializeDoc(this.doc), ...this.history() });
    this.broadcastPresence();
    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      try {
        this.handle(client, msg);
      } catch (e) {
        this.send(ws, { t: 'error', message: (e as Error).message, cid: (msg as { cid?: number }).cid });
      }
    });
    ws.on('close', () => {
      this.clients.delete(client.id);
      this.broadcastPresence();
    });
  }

  private handle(client: Client, msg: ClientMessage) {
    switch (msg.t) {
      case 'hello':
        if (msg.name) client.name = String(msg.name).slice(0, 40);
        this.broadcastPresence();
        break;
      case 'ops':
        this.apply(msg.ops, { origin: client.id, kind: 'editor', group: msg.group, cid: msg.cid });
        break;
      case 'undo':
        this.undo(client.id, 'editor');
        break;
      case 'redo':
        this.redo(client.id, 'editor');
        break;
    }
  }

  /* ------------------------------- API -------------------------------- */

  apply(ops: Op[], opts: { origin?: string; kind?: ClientKind; group?: string; cid?: number; label?: string } = {}): ApplyResult {
    if (!Array.isArray(ops) || !ops.length) throw new Error('No hay operaciones');
    const kind = opts.kind ?? 'claude';
    const origin = opts.origin ?? kind;
    const res = this.engine.apply(ops, { group: opts.group, origin, label: opts.label });
    // 'select' ops change no history but must still reach the editors.
    const selectOnly = res.ops.every((o) => o.type === 'select');
    if (res.changed || selectOnly) {
      this.broadcast({ t: 'ops', ops: res.ops, origin, originKind: kind, cid: opts.cid, bounds: res.bounds, ...this.history() });
      this.scheduleSave();
    } else if (opts.cid !== undefined) {
      // Let the sender know its op was processed even though it changed nothing.
      this.broadcast({ t: 'ops', ops: [], origin, originKind: kind, cid: opts.cid, bounds: null, ...this.history() });
    }
    return res;
  }

  private sendDoc(reason: string, origin: string, kind: ClientKind) {
    this.broadcast({ t: 'doc', doc: serializeDoc(this.doc), reason, origin, originKind: kind, ...this.history() });
    this.scheduleSave();
  }

  undo(origin = 'claude', kind: ClientKind = 'claude') {
    const e = this.engine.undo();
    if (e) this.sendDoc('undo', origin, kind);
    return e ? { undone: e.label, by: e.origin } : null;
  }

  redo(origin = 'claude', kind: ClientKind = 'claude') {
    const e = this.engine.redo();
    if (e) this.sendDoc('redo', origin, kind);
    return e ? { redone: e.label } : null;
  }

  activity(message: string, bounds?: Bounds | null) {
    this.broadcast({ t: 'activity', kind: 'claude', message: String(message).slice(0, 200), bounds });
  }

  info() {
    return {
      ...describeDoc(this.doc),
      editorsConnected: this.editorCount(),
      canUndo: this.engine.canUndo(),
      canRedo: this.engine.canRedo(),
      autosave: this.autosavePath,
    };
  }

  renderOptions(o: ImageOptions = {}): RenderOptions {
    const region = o.region;
    const w = region?.w ?? this.doc.width, h = region?.h ?? this.doc.height;
    return {
      frame: findFrameIndex(this.doc, o.frame),
      scale: o.scale ?? autoScale(w, h, 512),
      grid: o.grid ?? true,
      checkerboard: true,
      layerIds: o.layer !== undefined ? [findLayer(this.doc, o.layer).id] : undefined,
      region,
    };
  }

  /** PNG preview as base64 (for the model to look at). */
  image(o: ImageOptions = {}) {
    const opts = this.renderOptions(o);
    return { base64: renderPng(this.doc, opts).toString('base64'), scale: opts.scale };
  }

  /** Every frame side by side. */
  sheet(o: { scale?: number; columns?: number } = {}) {
    const r = renderSheetPng(this.doc, o);
    return { base64: r.png.toString('base64'), scale: r.scale, columns: r.columns, frames: this.doc.frames.map((f, i) => ({ index: i, duration: f.duration })) };
  }

  pixels(o: TextRegionOptions = {}) {
    return regionToText(this.doc, o);
  }

  /** Write the current image to disk as .png, .gif (animation) or .opx (project). */
  exportFile(path: string, o: { scale?: number; frame?: number | string; layer?: number | string } = {}) {
    if (!path) throw new Error('Falta la ruta');
    const abs = resolve(path.replace(/^~(?=$|[\\/])/, homedir()));
    const ext = extname(abs).toLowerCase();
    mkdirSync(dirname(abs), { recursive: true });
    const scale = Math.max(1, Math.min(64, Math.floor(o.scale ?? 1)));
    if (ext === '.opx' || ext === '.json') {
      writeFileSync(abs, JSON.stringify(serializeDoc(this.doc)));
    } else if (ext === '.gif') {
      const frames = this.doc.frames.map((f, i) => ({ pixels: compositePacked(this.doc, { frame: i }), delay: f.duration }));
      writeFileSync(abs, encodeGif(this.doc.width, this.doc.height, frames, { scale }));
    } else {
      const layerIds = o.layer !== undefined ? [findLayer(this.doc, o.layer).id] : undefined;
      writeFileSync(abs, renderPng(this.doc, { frame: findFrameIndex(this.doc, o.frame), scale, layerIds }));
    }
    return { path: abs };
  }

  openFile(path: string) {
    const abs = resolve(path.replace(/^~(?=$|[\\/])/, homedir()));
    const data = JSON.parse(readFileSync(abs, 'utf8')) as SerializedDoc;
    this.apply([{ type: 'load', doc: data }], { label: 'abrir' });
    return { opened: abs };
  }

  newCanvas(width: number, height: number, background?: string | null, name?: string) {
    const bg = background ? parseColor(background) : 0;
    const doc = createDoc(width, height, { background: bg, name, palette: this.doc.palette });
    this.apply([{ type: 'load', doc: serializeDoc(doc) }], { label: 'nuevo lienzo' });
    return { width, height };
  }

  /** Dispatch for the HTTP RPC used by MCP processes that are not the host. */
  rpc(method: string, p: any): unknown {
    switch (method) {
      case 'apply': return summarize(this.apply(p.ops, { kind: 'claude', origin: 'claude', label: p.label, group: p.group }));
      case 'undo': return this.undo();
      case 'redo': return this.redo();
      case 'info': return this.info();
      case 'image': return this.image(p);
      case 'pixels': return this.pixels(p);
      case 'sheet': return this.sheet(p);
      case 'export': return this.exportFile(p.path, p);
      case 'open': return this.openFile(p.path);
      case 'new': return this.newCanvas(p.width, p.height, p.background, p.name);
      case 'activity': this.activity(p.message, p.bounds); return { ok: true };
      default: throw new Error(`Método desconocido: ${method}`);
    }
  }
}

export function summarize(r: ApplyResult) {
  return { changed: r.changed, pixelsChanged: r.pixels, bounds: r.bounds };
}
