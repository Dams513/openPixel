import type { SerializedDoc } from './doc';
import type { Bounds, Op } from './ops';

export type ClientKind = 'editor' | 'claude';

export interface PresenceClient {
  id: string;
  name: string;
  kind: ClientKind;
}

/** Messages browser → server */
export type ClientMessage =
  | { t: 'hello'; name?: string }
  | { t: 'ops'; ops: Op[]; group?: string; cid?: number }
  | { t: 'undo' }
  | { t: 'redo' };

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

/** Messages server → browser */
export type ServerMessage =
  | ({ t: 'welcome'; clientId: string; doc: SerializedDoc } & HistoryState)
  | ({ t: 'ops'; ops: Op[]; origin: string; originKind: ClientKind; cid?: number; bounds: Bounds | null } & HistoryState)
  | ({ t: 'doc'; doc: SerializedDoc; reason: string; origin: string; originKind: ClientKind } & HistoryState)
  | { t: 'error'; message: string; cid?: number }
  | { t: 'presence'; clients: PresenceClient[] }
  | { t: 'activity'; kind: ClientKind; message: string; bounds?: Bounds | null };

export const DEFAULT_PORT = 5577;
