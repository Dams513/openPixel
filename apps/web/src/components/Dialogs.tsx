import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Anchor } from '@openpixel/core';
import { sendOps, setState, toast, useStore } from '../store';
import { exportGif, exportPng, exportSpritesheet, newCanvas, saveProject } from '../actions';

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, button.primary')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Cerrar" onClick={onClose}><X size={16} /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

const close = () => setState({ dialog: null });
const SIZES = [8, 16, 24, 32, 48, 64, 128, 256];

function NewDialog() {
  const [w, setW] = useState(32);
  const [h, setH] = useState(32);
  const [bg, setBg] = useState<'transparent' | 'white' | 'custom'>('transparent');
  const [custom, setCustom] = useState('#1d1d2b');
  const [name, setName] = useState('Sin título');
  const valid = w >= 1 && h >= 1 && w <= 1024 && h <= 1024;
  return (
    <Modal title="Nuevo lienzo" onClose={close}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          newCanvas(w, h, bg === 'transparent' ? null : bg === 'white' ? '#ffffff' : custom, name);
          close();
        }}
      >
        <label>Nombre<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="presets">
          {SIZES.map((s) => (
            <button type="button" key={s} className={w === s && h === s ? 'on' : ''} onClick={() => { setW(s); setH(s); }}>{s}×{s}</button>
          ))}
        </div>
        <div className="row">
          <label>Ancho<input type="number" min={1} max={1024} value={w} onChange={(e) => setW(Number(e.target.value))} /></label>
          <label>Alto<input type="number" min={1} max={1024} value={h} onChange={(e) => setH(Number(e.target.value))} /></label>
        </div>
        <fieldset className="row radios">
          <legend>Fondo</legend>
          <label><input type="radio" checked={bg === 'transparent'} onChange={() => setBg('transparent')} /> Transparente</label>
          <label><input type="radio" checked={bg === 'white'} onChange={() => setBg('white')} /> Blanco</label>
          <label><input type="radio" checked={bg === 'custom'} onChange={() => setBg('custom')} /> <input type="color" value={custom} onChange={(e) => { setCustom(e.target.value); setBg('custom'); }} /></label>
        </fieldset>
        <p className="muted">El lienzo actual se reemplaza (puedes deshacer con Ctrl+Z).</p>
        <footer><button type="button" onClick={close}>Cancelar</button><button className="primary" disabled={!valid}>Crear</button></footer>
      </form>
    </Modal>
  );
}

const ANCHORS: Anchor[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

function ResizeDialog() {
  const doc = useStore((s) => s.doc);
  const [w, setW] = useState(doc?.width ?? 32);
  const [h, setH] = useState(doc?.height ?? 32);
  const [anchor, setAnchor] = useState<Anchor>('center');
  const valid = w >= 1 && h >= 1 && w <= 1024 && h <= 1024;
  return (
    <Modal title="Tamaño del lienzo" onClose={close}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (!valid) return; sendOps([{ type: 'resize', width: w, height: h, anchor }]); close(); }}>
        <div className="row">
          <label>Ancho<input type="number" min={1} max={1024} value={w} onChange={(e) => setW(Number(e.target.value))} /></label>
          <label>Alto<input type="number" min={1} max={1024} value={h} onChange={(e) => setH(Number(e.target.value))} /></label>
        </div>
        <div>
          <span className="label">Anclaje</span>
          <div className="anchor-grid" role="radiogroup" aria-label="Anclaje">
            {ANCHORS.map((a) => (
              <button type="button" key={a} role="radio" aria-checked={anchor === a} aria-label={a} className={anchor === a ? 'on' : ''} onClick={() => setAnchor(a)} />
            ))}
          </div>
        </div>
        <p className="muted">No escala los píxeles: añade espacio o recorta los bordes.</p>
        <footer><button type="button" onClick={close}>Cancelar</button><button className="primary" disabled={!valid}>Aplicar</button></footer>
      </form>
    </Modal>
  );
}

function ExportDialog() {
  const doc = useStore((s) => s.doc);
  const [fmt, setFmt] = useState<'png' | 'gif' | 'sheet' | 'opx'>('png');
  const [scale, setScale] = useState(() => Math.max(1, Math.min(16, Math.floor(512 / Math.max(doc?.width ?? 32, doc?.height ?? 32)))));
  if (!doc) return null;
  const run = async () => {
    try {
      if (fmt === 'png') await exportPng(scale);
      else if (fmt === 'gif') exportGif(scale);
      else if (fmt === 'sheet') await exportSpritesheet(scale);
      else saveProject();
      close();
    } catch (e) {
      toast(`Error al exportar: ${(e as Error).message}`, 'error');
    }
  };
  return (
    <Modal title="Exportar" onClose={close}>
      <div className="form">
        <fieldset className="radios col">
          <label><input type="radio" checked={fmt === 'png'} onChange={() => setFmt('png')} /> PNG (frame actual)</label>
          <label><input type="radio" checked={fmt === 'gif'} onChange={() => setFmt('gif')} /> GIF animado ({doc.frames.length} {doc.frames.length === 1 ? 'frame' : 'frames'})</label>
          <label><input type="radio" checked={fmt === 'sheet'} onChange={() => setFmt('sheet')} /> Spritesheet PNG (frames en fila)</label>
          <label><input type="radio" checked={fmt === 'opx'} onChange={() => setFmt('opx')} /> Proyecto .opx (capas y frames)</label>
        </fieldset>
        {fmt !== 'opx' && (
          <label className="opt">
            Escala
            <input type="range" min={1} max={32} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
            <span className="num">{scale}× → {doc.width * scale}×{doc.height * scale}px</span>
          </label>
        )}
        <footer><button type="button" onClick={close}>Cancelar</button><button className="primary" onClick={run}>Descargar</button></footer>
      </div>
    </Modal>
  );
}

function HelpDialog() {
  const [mcpPath, setMcpPath] = useState('/ruta/a/openPixel/packages/server/dist/mcp.js');
  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((j) => j.mcpPath && setMcpPath(j.mcpPath)).catch(() => {});
  }, []);
  const desktop = JSON.stringify({ mcpServers: { openpixel: { command: 'node', args: [mcpPath] } } }, null, 2);
  const code = `claude mcp add openpixel -- node "${mcpPath}"`;
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Copiado'), () => toast('No se pudo copiar', 'error'));
  return (
    <Modal title="Conectar Claude" onClose={close}>
      <div className="help">
        <p>Claude dibuja en este lienzo a través de un servidor <b>MCP</b> local. Verás cada trazo en vivo y podrás deshacerlo con Ctrl+Z.</p>
        <h3>Claude Code</h3>
        <pre><code>{code}</code></pre>
        <button onClick={() => copy(code)}>Copiar comando</button>
        <h3>Claude Desktop</h3>
        <p className="muted">Ajustes → Desarrollador → Editar configuración (<code>claude_desktop_config.json</code>) y reinicia Claude:</p>
        <pre><code>{desktop}</code></pre>
        <button onClick={() => copy(desktop)}>Copiar configuración</button>
        <p className="muted">Después pídele algo como: <i>"Dibuja un gato pixel art de 32×32 en openPixel"</i>.</p>
        <h3>Atajos</h3>
        <ul className="shortcuts">
          <li><kbd>B</kbd> lápiz</li><li><kbd>E</kbd> borrador</li><li><kbd>G</kbd> bote</li><li><kbd>I</kbd> cuentagotas</li>
          <li><kbd>L</kbd> línea</li><li><kbd>U</kbd> rectángulo</li><li><kbd>O</kbd> elipse</li><li><kbd>D</kbd> tramado</li>
          <li><kbd>S</kbd> sombreado</li><li><kbd>M</kbd> selección</li><li><kbd>Q</kbd> lazo</li><li><kbd>W</kbd> varita mágica</li><li><kbd>T</kbd> texto</li><li><kbd>V</kbd> mover capa</li><li><kbd>H</kbd>/<kbd>Espacio</kbd> mano</li>
          <li><kbd>X</kbd> intercambiar colores</li><li><kbd>[</kbd> <kbd>]</kbd> tamaño</li><li><kbd>+</kbd> <kbd>-</kbd> <kbd>0</kbd> zoom</li><li><kbd>#</kbd> cuadrícula</li>
          <li><kbd>Ctrl+Z</kbd>/<kbd>Y</kbd> deshacer/rehacer</li><li><kbd>Ctrl+C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> portapapeles</li><li><kbd>,</kbd> <kbd>.</kbd> frames</li><li><kbd>Alt</kbd>+clic tomar color</li>
        </ul>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (dialog === 'new') return <NewDialog />;
  if (dialog === 'resize') return <ResizeDialog />;
  if (dialog === 'export') return <ExportDialog />;
  if (dialog === 'help') return <HelpDialog />;
  return null;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}
