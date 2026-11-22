import { useSyncExternalStore } from 'react';
import {
  applyOp,
  deserializeDoc,
  type Bounds,
  type ClientKind,
  type ClientMessage,
  type Doc,
  type Mirror,
  type Op,
  type PresenceClient,
  type ServerMessage,
} from '@openpixel/core';

export type ToolId =
  | 'pencil' | 'eraser' | 'bucket' | 'picker' | 'line' | 'rect' | 'ellipse'
  | 'select' | 'move' | 'dither' | 'shade' | 'pan';

export interface Selection { x: number; y: number; w: number; h: number }

export interface Toast { id: number; text: string; kind: 'info' | 'error' }

export interface State {
  doc: Doc | null;
  /** Increments every time the document changes (drives re-rendering). */
  version: number;
  connected: boolean;
  clientId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  clients: PresenceClient[];

  tool: ToolId;
  primary: string;
  secondary: string;
  brushSize: number;
  brushShape: 'square' | 'round';
  mirror: Mirror;
  shapeFilled: boolean;
  fillContiguous: boolean;
  shadeAmount: number;

  zoom: number;
  showGrid: boolean;
  onionSkin: boolean;
  playing: boolean;
  cursor: { x: number; y: number } | null;
  selection: Selection | null;

  claude: { message: string; at: number; bounds: Bounds | null } | null;
  toasts: Toast[];
  dialog: null | 'new' | 'export' | 'resize' | 'help';
}

const initial: State = {
  doc: null,
  version: 0,
  connected: false,
  clientId: null,
  canUndo: false,
  canRedo: false,
  clients: [],
  tool: 'pencil',
  primary: '#1d1d2b',
  secondary: '#ffffff',
  brushSize: 1,
  brushShape: 'square',
  mirror: 'none',
  shapeFilled: false,
  fillContiguous: true,
  shadeAmount: 0.08,
  zoom: 16,
  showGrid: true,
  onionSkin: false,
  playing: false,
  cursor: null,
  selection: null,
  claude: null,
  toasts: [],
  dialog: null,
};

const PREFS_KEY = 'openpixel.prefs';
const PERSISTED: (keyof State)[] = ['tool', 'primary', 'secondary', 'brushSize', 'brushShape', 'mirror', 'shapeFilled', 'fillContiguous', 'showGrid', 'onionSkin'];

function loadPrefs(): Partial<State> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

let state: State = { ...initial, ...loadPrefs() };
const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  if (PERSISTED.some((k) => k in p)) {
    try {
      const prefs: Record<string, unknown> = {};
      for (const k of PERSISTED) prefs[k] = state[k];
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch { /* storage unavailable */ }
  }
  for (const l of listeners) l();
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 5000 : 2500);
}

/* ----------------------------- networking ----------------------------- */

let ws: WebSocket | null = null;
let retry = 0;
let cid = 0;

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function connect() {
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    retry = 0;
    send({ t: 'hello', name: 'Editor' });
  };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data) as ServerMessage);
  ws.onclose = () => {
    setState({ connected: false });
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 250 * 2 ** retry);
  };
}

function send(msg: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function sendOps(ops: Op[], group?: string) {
  if (!state.connected) {
    toast('Sin conexión con el servidor openPixel', 'error');
    return;
  }
  send({ t: 'ops', ops, group, cid: ++cid });
}

export function undo() { send({ t: 'undo' }); }
export function redo() { send({ t: 'redo' }); }

function markClaude(kind: ClientKind, bounds: Bounds | null, message?: string) {
  if (kind !== 'claude') return;
  setState((s) => ({ claude: { message: message ?? s.claude?.message ?? 'Claude está dibujando…', at: Date.now(), bounds } }));
}

function handle(msg: ServerMessage) {
  switch (msg.t) {
    case 'welcome':
      setState({ doc: deserializeDoc(msg.doc), version: state.version + 1, connected: true, clientId: msg.clientId, canUndo: msg.canUndo, canRedo: msg.canRedo, selection: null });
      break;
    case 'ops': {
      const doc = state.doc;
      if (!doc) return;
      let sizeChanged = false;
      for (const op of msg.ops) {
        const w = doc.width, h = doc.height;
        try {
          applyOp(doc, op);
        } catch (e) {
          console.error('op falló en el cliente', op, e);
        }
        if (doc.width !== w || doc.height !== h) sizeChanged = true;
      }
      setState({ version: state.version + 1, canUndo: msg.canUndo, canRedo: msg.canRedo, ...(sizeChanged ? { selection: null } : {}) });
      if (msg.ops.length) markClaude(msg.originKind, msg.bounds);
      break;
    }
    case 'doc': {
      const doc = deserializeDoc(msg.doc);
      const prev = state.doc;
      const sizeChanged = !prev || prev.width !== doc.width || prev.height !== doc.height;
      setState({ doc, version: state.version + 1, canUndo: msg.canUndo, canRedo: msg.canRedo, ...(sizeChanged ? { selection: null } : {}) });
      markClaude(msg.originKind, null, msg.originKind === 'claude' ? `Claude: ${msg.reason === 'undo' ? 'deshizo un cambio' : 'rehízo un cambio'}` : undefined);
      break;
    }
    case 'error':
      toast(msg.message, 'error');
      break;
    case 'presence':
      setState({ clients: msg.clients });
      break;
    case 'activity':
      setState({ claude: { message: msg.message, at: Date.now(), bounds: msg.bounds ?? null } });
      break;
  }
}

/* ------------------------------- helpers ------------------------------ */

export function newGroup() {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function swapColors() {
  setState((s) => ({ primary: s.secondary, secondary: s.primary }));
}
