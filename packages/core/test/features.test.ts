import { describe, expect, it } from 'vitest';
import {
  Engine, createDoc, toHex, findLayer, encodeMask, decodeMask, polygonRegion, combineRegions, toRegion,
  regionFromIndices, layoutText, measureText, regionToText, ANIM_PRESETS, FONTS,
} from '../src';

const px = (e: Engine, x: number, y: number, layer?: string, frame?: number) =>
  toHex(findLayer(e.doc, layer).cels[frame ?? e.doc.activeFrame][y * e.doc.width + x]);

describe('masks & selections', () => {
  it('round-trips bit-packed masks', () => {
    const m = Uint8Array.from([1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1]);
    expect([...decodeMask(encodeMask(m), m.length)]).toEqual([...m]);
  });

  it('builds polygon (lasso) regions', () => {
    const r = polygonRegion([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }], 10, 10)!;
    expect(r.x).toBe(0);
    expect(r.mask).toBeDefined();
    const inside = (x: number, y: number) => r.mask![(y - r.y) * r.w + (x - r.x)] === 1;
    expect(inside(0, 0)).toBe(true);
    expect(inside(3, 3)).toBe(false);
  });

  it('adds and subtracts regions', () => {
    const a = { x: 0, y: 0, w: 2, h: 2 };
    const b = { x: 2, y: 0, w: 2, h: 2 };
    const u = combineRegions(a, b, 'add')!;
    expect([u.x, u.w, u.h, u.mask]).toEqual([0, 4, 2, undefined]);
    const d = combineRegions(u, { x: 1, y: 0, w: 2, h: 2 }, 'subtract')!;
    expect([...d.mask!]).toEqual([1, 0, 0, 1, 1, 0, 0, 1]);
  });

  it('clips drawing to a masked selection and moves masked pixels', () => {
    const e = new Engine(createDoc(4, 1));
    const sel = regionFromIndices([0, 2], 4)!; // pixels x=0 and x=2
    e.apply([{ type: 'rect', x: 0, y: 0, w: 4, h: 1, color: '#f00', filled: true, clip: toRegion(sel) }]);
    expect([0, 1, 2, 3].map((x) => px(e, x, 0))).toEqual(['#ff0000', null, '#ff0000', null]);
    e.apply([{ type: 'moveRegion', ...toRegion(sel), dx: 1, dy: 0 }]);
    expect([0, 1, 2, 3].map((x) => px(e, x, 0))).toEqual([null, '#ff0000', null, '#ff0000']);
  });
});

describe('text', () => {
  it('lays out and measures text', () => {
    expect(measureText('HI')).toEqual({ width: 5 + 1 + 3, height: 7 });
    expect(measureText('HI', { scale: 2 })).toEqual({ width: 18, height: 14 });
    expect(measureText('A\nB')).toEqual({ width: 5, height: 17 });
    expect(layoutText('ñ').pixels.length).toBeGreaterThan(layoutText('n').pixels.length);
    expect(measureText('hola', { font: 'tiny' }).height).toBe(5);
  });

  it('every glyph has consistent row widths', () => {
    for (const f of Object.values(FONTS)) for (const [ch, g] of Object.entries(f.glyphs)) {
      const w = g.rows[0].length;
      for (const r of g.rows) expect(r.length, `${f.id} "${ch}"`).toBe(w);
    }
  });

  it('draws text with outline', () => {
    const e = new Engine(createDoc(12, 11));
    e.apply([{ type: 'text', x: 1, y: 1, text: 'I', color: '#fff', outline: '#000' }]);
    const t = regionToText(e.doc);
    expect(t.rows[0]).toBe('00000.......');
    expect(px(e, 2, 1)).toBe('#ffffff');
    expect(px(e, 0, 0)).toBe('#000000');
    expect(px(e, 1, 9)).toBe(null);
  });
});

describe('animation', () => {
  const sprite = () => {
    const e = new Engine(createDoc(16, 16));
    e.apply([{ type: 'addLayer', name: 'bg' }, { type: 'moveLayer', layer: 'bg', index: 0 }]);
    e.apply([{ type: 'rect', x: 0, y: 0, w: 16, h: 16, color: '#123456', filled: true, layer: 'bg' }]);
    e.apply([{ type: 'rect', x: 5, y: 6, w: 6, h: 8, color: '#ff0000', filled: true, layer: 'Capa 1' }]);
    return e;
  };

  it('generates every preset and is undoable', () => {
    for (const preset of ANIM_PRESETS) {
      const e = sprite();
      e.apply([{ type: 'animate', preset, layer: 'Capa 1' }]);
      expect(e.doc.frames.length, preset).toBeGreaterThan(1);
      // background layer copied to every frame
      for (let f = 0; f < e.doc.frames.length; f++) expect(px(e, 0, 0, 'bg', f)).toBe('#123456');
      e.undo();
      expect(e.doc.frames.length).toBe(1);
    }
  });

  it('jump moves the sprite up', () => {
    const e = sprite();
    e.apply([{ type: 'animate', preset: 'jump', layer: 'Capa 1' }]);
    const topRow = (f: number) => {
      const cel = findLayer(e.doc, 'Capa 1').cels[f];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (cel[y * 16 + x]) return y;
      return -1;
    };
    expect(topRow(3)).toBeLessThan(topRow(0));
  });

  it('append mode keeps existing frames', () => {
    const e = sprite();
    e.apply([{ type: 'animate', preset: 'walk', layer: 'Capa 1' }]);
    e.apply([{ type: 'animate', preset: 'jump', layer: 'Capa 1', frame: 0, mode: 'append' }]);
    expect(e.doc.frames.length).toBe(12);
    expect(e.doc.activeFrame).toBe(4);
  });

  it('fails on empty layers', () => {
    const e = new Engine(createDoc(8, 8));
    expect(() => e.apply([{ type: 'animate', preset: 'walk' }])).toThrow(/vacía/);
  });
});
