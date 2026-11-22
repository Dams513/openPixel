import { createDoc, type Doc } from './doc';
import { applyOp, changeBounds, countChangedPixels, normalizeOp, reapplyChange, revertChange, type Bounds, type Change, type Op } from './ops';

export interface HistoryEntry {
  group?: string;
  label: string;
  origin: string;
  changes: Change[];
}

export interface ApplyResult {
  ops: Op[];
  changed: boolean;
  pixels: number;
  bounds: Bounds | null;
}

/**
 * Owns a document plus its undo/redo history. Used as the single source of
 * truth by the server; clients only replay ops.
 */
export class Engine {
  doc: Doc;
  undoStack: HistoryEntry[] = [];
  redoStack: HistoryEntry[] = [];
  limit = 300;

  constructor(doc?: Doc) {
    this.doc = doc ?? createDoc(32, 32);
  }

  /**
   * Apply a batch of ops atomically: if any op throws, everything done by the
   * batch is reverted and the error is rethrown.
   * Ops sharing the same `group` as the previous history entry are merged into
   * it (one pencil stroke = one undo step).
   */
  apply(rawOps: Op[], opts: { group?: string; origin?: string; label?: string } = {}): ApplyResult {
    const ops = rawOps.map(normalizeOp);
    const changes: Change[] = [];
    try {
      for (const op of ops) changes.push(...applyOp(this.doc, op));
    } catch (e) {
      for (let i = changes.length - 1; i >= 0; i--) revertChange(this.doc, changes[i]);
      throw e;
    }
    const result: ApplyResult = {
      ops,
      changed: changes.length > 0,
      pixels: countChangedPixels(changes),
      bounds: changeBounds(this.doc, changes),
    };
    if (!changes.length) return result;
    const top = this.undoStack[this.undoStack.length - 1];
    if (opts.group && top && top.group === opts.group && this.redoStack.length === 0) {
      top.changes.push(...changes);
    } else {
      this.undoStack.push({ group: opts.group, label: opts.label ?? ops[0]?.type ?? 'edit', origin: opts.origin ?? 'unknown', changes });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
    return result;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo(): HistoryEntry | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    for (let i = e.changes.length - 1; i >= 0; i--) revertChange(this.doc, e.changes[i]);
    this.redoStack.push(e);
    return e;
  }

  redo(): HistoryEntry | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    for (const ch of e.changes) reapplyChange(this.doc, ch);
    this.undoStack.push(e);
    return e;
  }

  reset(doc: Doc) {
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
  }
}
