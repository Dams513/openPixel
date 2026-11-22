import { describe, expect, it } from 'vitest';
import {
  Engine, createDoc, parseColor, toHex, serializeDoc, deserializeDoc, regionToText, compositePacked, findLayer,
} from '../src';

const px = (e: Engine, x: number, y: number, layer?: string) =>
  toHex(findLayer(e.doc, layer).cels[e.doc.activeFrame][y * e.doc.width + x]);

describe('color', () => {
  it('parses formats', () => {
    expect(toHex(parseColor('#f00'))).toBe('#ff0000');
    expect(toHex(parseColor('#11223344'))).toBe('#11223344');
    expect(parseColor(null)).toBe(0);
    expect(parseColor('transparent')).toBe(0);
    expect(toHex(parseColor('white'))).toBe('#ffffff');
    expect(() => parseColor('#zzz')).toThrow();
  });
});

describe('engine', () => {
  it('draws and undoes/redoes', () => {
    const e = new Engine(createDoc(8, 8));
    e.apply([{ type: 'line', x1: 0, y1: 0, x2: 7, y2: 7, color: '#ff0000' }]);
    expect(px(e, 3, 3)).toBe('#ff0000');
    e.undo();
    expect(px(e, 3, 3)).toBe(null);
    e.redo();
    expect(px(e, 3, 3)).toBe('#ff0000');
  });

  it('groups strokes into one undo step', () => {
    const e = new Engine(createDoc(8, 8));
    e.apply([{ type: 'plot', points: [0, 0], color: '#fff' }], { group: 'g1' });
    e.apply([{ type: 'plot', points: [0, 0, 3, 0], color: '#fff' }], { group: 'g1' });
    expect(e.undoStack.length).toBe(1);
    e.undo();
    expect(px(e, 2, 0)).toBe(null);
  });

  it('is atomic on batch failure', () => {
    const e = new Engine(createDoc(4, 4));
    expect(() => e.apply([
      { type: 'pixels', pixels: [[0, 0, '#fff']] },
      { type: 'pixels', pixels: [[1, 0, '#fff'], [2, 0, 'nope']] },
    ])).toThrow();
    expect(px(e, 0, 0)).toBe(null);
    expect(px(e, 1, 0)).toBe(null);
    expect(e.undoStack.length).toBe(0);
  });

  it('grid op and regionToText round-trip', () => {
    const e = new Engine(createDoc(5, 3));
    e.apply([{ type: 'grid', x: 0, y: 0, rows: ['.#.#.', '#####', '.#.#.'], legend: { '#': '#00ff00' } }]);
    const t = regionToText(e.doc);
    expect(t.rows).toEqual(['.0.0.', '00000', '.0.0.']);
    expect(t.legend).toEqual({ '0': '#00ff00' });
    expect(() => e.apply([{ type: 'grid', x: 0, y: 0, rows: ['x'], legend: {} }])).toThrow(/no está en el legend/);
  });

  it('fill, shapes, layers, frames', () => {
    const e = new Engine(createDoc(10, 10));
    e.apply([{ type: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000' }]);
    e.apply([{ type: 'fill', x: 5, y: 5, color: '#00f' }]);
    expect(px(e, 5, 5)).toBe('#0000ff');
    expect(px(e, 0, 0)).toBe('#000000');
    e.apply([{ type: 'addLayer', name: 'Top' }]);
    expect(e.doc.layers.length).toBe(2);
    e.apply([{ type: 'ellipse', x: 2, y: 2, w: 6, h: 6, color: '#f00', filled: true }]);
    expect(px(e, 5, 5, 'Top')).toBe('#ff0000');
    expect(toHex(compositePacked(e.doc)[5 * 10 + 5])).toBe('#ff0000');
    e.apply([{ type: 'addFrame', duplicate: true }]);
    expect(e.doc.frames.length).toBe(2);
    expect(e.doc.activeFrame).toBe(1);
    expect(px(e, 5, 5, 'Top')).toBe('#ff0000');
    e.undo();
    expect(e.doc.frames.length).toBe(1);
    e.apply([{ type: 'mergeDown', layer: 'Top' }]);
    expect(e.doc.layers.length).toBe(1);
    expect(px(e, 5, 5)).toBe('#ff0000');
  });

  it('mirror, flip, shift, resize', () => {
    const e = new Engine(createDoc(4, 4));
    e.apply([{ type: 'plot', points: [0, 0], color: '#fff', mirror: 'x' }]);
    expect(px(e, 3, 0)).toBe('#ffffff');
    e.apply([{ type: 'flip', axis: 'v' }]);
    expect(px(e, 0, 3)).toBe('#ffffff');
    e.apply([{ type: 'shift', dx: 1, dy: 0 }]);
    expect(px(e, 1, 3)).toBe('#ffffff');
    e.apply([{ type: 'resize', width: 6, height: 6, anchor: 'center' }]);
    expect(e.doc.width).toBe(6);
    expect(px(e, 2, 4)).toBe('#ffffff');
  });

  it('serializes', () => {
    const e = new Engine(createDoc(3, 3));
    e.apply([{ type: 'pixels', pixels: [[1, 1, '#12345678']] }]);
    const d = deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(e.doc))));
    expect(toHex(d.layers[0].cels[0][4])).toBe('#12345678');
  });
});
