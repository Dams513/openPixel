import { useEffect, useState } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { normalizeColor } from '@openpixel/core';
import { getState, sendOps, setState, swapColors, toast, useStore } from '../store';

export const PRESET_PALETTES: Record<string, string[]> = {
  'openPixel 32': [
    '#000000', '#1d1d2b', '#3b3b54', '#5d5d7a', '#8b8ba8', '#c2c2d6', '#ffffff', '#f4e1c1',
    '#7a2e2e', '#c0392b', '#ff6b5b', '#ffb3a7', '#7a4a1e', '#d97a2b', '#ffb347', '#ffe08a',
    '#2e5a1e', '#3fa34d', '#8fd86b', '#d6f5a3', '#1e4a5a', '#2b8fbf', '#5ccfff', '#b3ecff',
    '#2a1e5a', '#5b3fbf', '#a58bff', '#ff7ad9', '#6b3a2a', '#a8683f', '#e0a878', '#4a3020',
  ],
  'Verde retro (4)': ['#0f2a1a', '#2f5d3a', '#7fae5a', '#d3e8a0'],
  'Grises (8)': ['#000000', '#242424', '#494949', '#6d6d6d', '#929292', '#b6b6b6', '#dbdbdb', '#ffffff'],
  'Atardecer (8)': ['#1b1033', '#3d1a4f', '#7a2758', '#c23b52', '#f0634a', '#ff9e57', '#ffd27a', '#fff3c4'],
  'Pastel (16)': [
    '#fdfdfd', '#f2d0d9', '#f7b2bd', '#e8879c', '#f9dcc4', '#fcb69f', '#fde2a7', '#fff1b5',
    '#d4f0c8', '#a9e5bb', '#b5ead7', '#9ad1d4', '#c7ceea', '#a0a8e0', '#d5b8f0', '#7d6b91',
  ],
  'Tierra (12)': ['#2b1d14', '#4a3222', '#6e4a2f', '#94673f', '#b98a56', '#d9b382', '#efd9ad', '#3d4a2a', '#5f7339', '#8a9a4e', '#4f6b73', '#8aa6a3'],
};

function HexInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    try {
      const n = normalizeColor(text);
      if (n) onChange(n);
      else setText(value);
    } catch {
      setText(value);
    }
  };
  return (
    <input
      className="hex"
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      aria-label="Color hexadecimal"
    />
  );
}

export function ColorPanel() {
  const primary = useStore((s) => s.primary);
  const secondary = useStore((s) => s.secondary);
  const doc = useStore((s) => s.doc);
  useStore((s) => s.version);
  const palette = doc?.palette ?? [];

  const setPalette = (colors: string[]) => sendOps([{ type: 'setPalette', colors }]);

  return (
    <section className="panel">
      <header className="panel-head"><h2>Color</h2></header>
      <div className="colors">
        <div className="swatch-pair">
          <label className="big-swatch primary" style={{ background: primary }} title="Color principal (clic izquierdo)">
            <input type="color" value={primary.slice(0, 7)} onChange={(e) => setState({ primary: e.target.value })} />
          </label>
          <label className="big-swatch secondary" style={{ background: secondary }} title="Color secundario (clic derecho)">
            <input type="color" value={secondary.slice(0, 7)} onChange={(e) => setState({ secondary: e.target.value })} />
          </label>
          <button className="icon-btn swap" onClick={swapColors} title="Intercambiar (X)" aria-label="Intercambiar colores"><ArrowLeftRight size={14} /></button>
        </div>
        <div className="hexes">
          <HexInput value={primary} onChange={(v) => setState({ primary: v })} />
          <HexInput value={secondary} onChange={(v) => setState({ secondary: v })} />
        </div>
      </div>

      <div className="palette-head">
        <select
          aria-label="Paleta predefinida"
          value=""
          onChange={(e) => {
            const p = PRESET_PALETTES[e.target.value];
            if (p) setPalette(p);
          }}
        >
          <option value="">Cargar paleta…</option>
          {Object.keys(PRESET_PALETTES).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button
          className="icon-btn"
          title="Añadir color principal a la paleta"
          aria-label="Añadir color a la paleta"
          onClick={() => {
            const p = getState().primary.toLowerCase();
            if (palette.map((c) => c.toLowerCase()).includes(p)) return toast('Ese color ya está en la paleta');
            setPalette([...palette, p]);
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="palette" role="listbox" aria-label="Paleta">
        {palette.map((c, i) => (
          <button
            key={`${c}-${i}`}
            className={`swatch ${c.toLowerCase() === primary.toLowerCase() ? 'sel' : ''}`}
            style={{ background: c }}
            title={`${c} · clic: principal · clic der.: secundario · Mayús+clic: quitar`}
            onClick={(e) => {
              if (e.shiftKey) setPalette(palette.filter((_, j) => j !== i));
              else setState({ primary: c });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setState({ secondary: c });
            }}
          />
        ))}
      </div>
    </section>
  );
}
