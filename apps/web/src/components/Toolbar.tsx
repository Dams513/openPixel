import { useEffect, useRef, type ComponentType } from 'react';
import {
  Check, Circle, Eraser, FlipHorizontal2, Grid2x2, Hand, Lasso, Move, PaintBucket, Pencil, Pipette, Slash, Square, SquareDashed, SunMedium, Type, WandSparkles,
} from 'lucide-react';
import { FONTS, type Mirror } from '@openpixel/core';
import { setState, useStore, type ToolId } from '../store';
import { commitText } from '../actions';

const TOOLS: { id: ToolId; label: string; key: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'pencil', label: 'Lápiz', key: 'B', Icon: Pencil },
  { id: 'eraser', label: 'Borrador', key: 'E', Icon: Eraser },
  { id: 'bucket', label: 'Bote de pintura', key: 'G', Icon: PaintBucket },
  { id: 'picker', label: 'Cuentagotas', key: 'I', Icon: Pipette },
  { id: 'line', label: 'Línea', key: 'L', Icon: Slash },
  { id: 'rect', label: 'Rectángulo', key: 'U', Icon: Square },
  { id: 'ellipse', label: 'Elipse', key: 'O', Icon: Circle },
  { id: 'dither', label: 'Tramado (dither)', key: 'D', Icon: Grid2x2 },
  { id: 'shade', label: 'Sombreado: izq. aclara, der. oscurece', key: 'S', Icon: SunMedium },
  { id: 'select', label: 'Selección rectangular', key: 'M', Icon: SquareDashed },
  { id: 'lasso', label: 'Lazo (selección libre)', key: 'Q', Icon: Lasso },
  { id: 'wand', label: 'Varita mágica (selecciona por color)', key: 'W', Icon: WandSparkles },
  { id: 'text', label: 'Texto', key: 'T', Icon: Type },
  { id: 'move', label: 'Mover capa', key: 'V', Icon: Move },
  { id: 'pan', label: 'Mano (o mantén Espacio)', key: 'H', Icon: Hand },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  return (
    <nav className="toolbar" aria-label="Herramientas">
      {TOOLS.map(({ id, label, key, Icon }) => (
        <button
          key={id}
          className={`tool ${tool === id ? 'active' : ''}`}
          title={`${label} (${key})`}
          aria-label={label}
          aria-pressed={tool === id}
          onClick={() => setState({ tool: id })}
        >
          <Icon size={18} />
        </button>
      ))}
    </nav>
  );
}

const MIRRORS: { id: Mirror; label: string }[] = [
  { id: 'none', label: 'No' },
  { id: 'x', label: 'Horizontal' },
  { id: 'y', label: 'Vertical' },
  { id: 'xy', label: 'Ambos' },
];

/** Contextual options for the current tool. */
export function ToolOptions() {
  const tool = useStore((s) => s.tool);
  const size = useStore((s) => s.brushSize);
  const shape = useStore((s) => s.brushShape);
  const mirror = useStore((s) => s.mirror);
  const filled = useStore((s) => s.shapeFilled);
  const contiguous = useStore((s) => s.fillContiguous);
  const shadeAmount = useStore((s) => s.shadeAmount);
  const wandContiguous = useStore((s) => s.wandContiguous);

  const usesSize = ['pencil', 'eraser', 'dither', 'shade', 'line', 'rect'].includes(tool);
  const usesShape = ['pencil', 'eraser', 'dither', 'shade'].includes(tool);
  const usesMirror = ['pencil', 'eraser', 'dither', 'shade', 'line', 'rect', 'ellipse'].includes(tool);

  return (
    <div className="tool-options">
      {usesSize && (
        <label className="opt">
          Tamaño
          <input type="range" min={1} max={32} value={size} onChange={(e) => setState({ brushSize: Number(e.target.value) })} />
          <span className="num">{size}px</span>
        </label>
      )}
      {usesShape && (
        <div className="seg" role="group" aria-label="Forma del pincel">
          <button className={shape === 'square' ? 'on' : ''} onClick={() => setState({ brushShape: 'square' })}>Cuadrado</button>
          <button className={shape === 'round' ? 'on' : ''} onClick={() => setState({ brushShape: 'round' })}>Redondo</button>
        </div>
      )}
      {(tool === 'rect' || tool === 'ellipse') && (
        <label className="opt check">
          <input type="checkbox" checked={filled} onChange={(e) => setState({ shapeFilled: e.target.checked })} /> Relleno
        </label>
      )}
      {tool === 'bucket' && (
        <label className="opt check">
          <input type="checkbox" checked={!contiguous} onChange={(e) => setState({ fillContiguous: !e.target.checked })} /> Reemplazar todo el color
        </label>
      )}
      {tool === 'shade' && (
        <label className="opt">
          Intensidad
          <input type="range" min={2} max={30} value={Math.round(shadeAmount * 100)} onChange={(e) => setState({ shadeAmount: Number(e.target.value) / 100 })} />
        </label>
      )}
      {usesMirror && (
        <div className="opt">
          <FlipHorizontal2 size={15} aria-hidden />
          <span>Espejo</span>
          <div className="seg" role="group" aria-label="Espejo">
            {MIRRORS.map((m) => (
              <button key={m.id} className={mirror === m.id ? 'on' : ''} onClick={() => setState({ mirror: m.id })}>{m.label}</button>
            ))}
          </div>
        </div>
      )}
      {(tool === 'line' || tool === 'rect' || tool === 'ellipse') && <span className="hint">Mayús: proporciones perfectas</span>}
      {tool === 'wand' && (
        <label className="opt check">
          <input type="checkbox" checked={!wandContiguous} onChange={(e) => setState({ wandContiguous: !e.target.checked })} /> Todo el color (no contiguo)
        </label>
      )}
      {tool === 'text' && <TextOptions />}
      {(tool === 'select' || tool === 'lasso' || tool === 'wand') && (
        <span className="hint">Mayús: añadir · Ctrl: quitar · arrastra dentro para mover (Alt copia) · Supr borra · Ctrl+C/X/V · Esc deselecciona</span>
      )}
      {tool === 'picker' && <span className="hint">Clic izq. → color principal · clic der. → secundario</span>}
      {['pencil', 'bucket', 'line', 'rect', 'ellipse', 'dither'].includes(tool) && <span className="hint">Clic der. usa el color secundario · Alt+clic toma color</span>}
    </div>
  );
}

function TextOptions() {
  const draft = useStore((s) => s.textDraft);
  const font = useStore((s) => s.textFont);
  const scale = useStore((s) => s.textScale);
  const outline = useStore((s) => s.textOutline);
  const shadow = useStore((s) => s.textShadow);
  const ref = useRef<HTMLInputElement>(null);
  const pos = draft ? `${draft.x},${draft.y}` : '';
  useEffect(() => {
    if (pos) ref.current?.focus();
  }, [pos]);
  return (
    <>
      <input
        ref={ref}
        id="text-tool-input"
        className="text-input"
        placeholder={draft ? 'Escribe… (Enter aplica)' : 'Haz clic en el lienzo'}
        readOnly={!draft}
        value={draft?.text ?? ''}
        onChange={(e) => draft && setState({ textDraft: { ...draft, text: e.target.value } })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitText(); }
          if (e.key === 'Escape') { setState({ textDraft: null }); (e.target as HTMLInputElement).blur(); }
        }}
        aria-label="Texto"
      />
      <button className="icon-btn" title="Aplicar texto (Enter)" aria-label="Aplicar texto" disabled={!draft?.text} onClick={commitText}><Check size={16} /></button>
      <select value={font} onChange={(e) => setState({ textFont: e.target.value })} aria-label="Fuente" className="mini-select">
        {Object.values(FONTS).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      <label className="opt">
        Escala
        <input type="number" className="mini-num" min={1} max={16} value={scale} onChange={(e) => setState({ textScale: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })} />
      </label>
      <label className="opt check"><input type="checkbox" checked={outline} onChange={(e) => setState({ textOutline: e.target.checked })} /> Contorno</label>
      <label className="opt check"><input type="checkbox" checked={shadow} onChange={(e) => setState({ textShadow: e.target.checked })} /> Sombra</label>
      <span className="hint">Contorno y sombra usan el color secundario</span>
    </>
  );
}
