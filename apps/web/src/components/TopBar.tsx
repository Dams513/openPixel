import { useEffect, useState } from 'react';
import {
  Bot, Download, FilePlus2, FlipHorizontal2, FlipVertical2, FolderOpen, Grid3x3, HelpCircle, ImagePlus, Maximize,
  Redo2, RotateCw, Save, Scaling, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { redo, sendOps, setState, undo, useStore } from '../store';
import { importImage, openFile, saveProject } from '../actions';
import { viewportApi } from './Viewport';

function ClaudeChip() {
  const claude = useStore((s) => s.claude);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const age = claude ? Date.now() - claude.at : Infinity;
  const active = age < 3000;
  const label = !claude ? 'Claude: esperando' : active ? claude.message : age < 60000 ? `Claude: hace ${Math.round(age / 1000)} s` : 'Claude: en espera';
  return (
    <button className={`claude-chip ${active ? 'active' : ''}`} title={claude?.message ?? 'Conecta Claude con el servidor MCP para que dibuje contigo'} onClick={() => setState({ dialog: 'help' })}>
      <Bot size={15} aria-hidden />
      <span className="claude-text">{label}</span>
    </button>
  );
}

export function TopBar() {
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const zoom = useStore((s) => s.zoom);
  const grid = useStore((s) => s.showGrid);
  const connected = useStore((s) => s.connected);
  const name = useStore((s) => s.doc?.name ?? '');
  const [title, setTitle] = useState(name);
  useEffect(() => setTitle(name), [name]);

  return (
    <header className="topbar">
      <div className="brand" aria-label="openPixel">
        <svg viewBox="0 0 8 8" width="20" height="20" shapeRendering="crispEdges" aria-hidden>
          <rect width="8" height="8" rx="1" fill="#1d1d2b" />
          <rect x="1" y="1" width="3" height="3" fill="#ff6b5b" />
          <rect x="4" y="1" width="3" height="3" fill="#ffb347" />
          <rect x="1" y="4" width="3" height="3" fill="#5ccfff" />
          <rect x="4" y="4" width="3" height="3" fill="#8fd86b" />
        </svg>
        <span>open<b>Pixel</b></span>
      </div>
      <input
        className="doc-name"
        value={title}
        aria-label="Nombre del dibujo"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== name && sendOps([{ type: 'rename', name: title.trim() }])}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />

      <div className="group">
        <button className="icon-btn" title="Nuevo lienzo" aria-label="Nuevo lienzo" onClick={() => setState({ dialog: 'new' })}><FilePlus2 size={16} /></button>
        <button className="icon-btn" title="Abrir .opx o imagen (Ctrl+O)" aria-label="Abrir" onClick={() => openFile()}><FolderOpen size={16} /></button>
        <button className="icon-btn" title="Guardar proyecto .opx (Ctrl+S)" aria-label="Guardar" onClick={saveProject}><Save size={16} /></button>
        <button className="icon-btn" title="Importar imagen como capa" aria-label="Importar imagen" onClick={() => importImage()}><ImagePlus size={16} /></button>
        <button className="icon-btn" title="Exportar PNG / GIF / spritesheet" aria-label="Exportar" onClick={() => setState({ dialog: 'export' })}><Download size={16} /></button>
      </div>

      <div className="group">
        <button className="icon-btn" title="Deshacer (Ctrl+Z)" aria-label="Deshacer" disabled={!canUndo} onClick={undo}><Undo2 size={16} /></button>
        <button className="icon-btn" title="Rehacer (Ctrl+Y)" aria-label="Rehacer" disabled={!canRedo} onClick={redo}><Redo2 size={16} /></button>
      </div>

      <div className="group">
        <button className="icon-btn" title="Voltear capa horizontalmente" aria-label="Voltear horizontal" onClick={() => sendOps([{ type: 'flip', axis: 'h' }])}><FlipHorizontal2 size={16} /></button>
        <button className="icon-btn" title="Voltear capa verticalmente" aria-label="Voltear vertical" onClick={() => sendOps([{ type: 'flip', axis: 'v' }])}><FlipVertical2 size={16} /></button>
        <button className="icon-btn" title="Rotar capa 90°" aria-label="Rotar" onClick={() => sendOps([{ type: 'rotate', dir: 'cw' }])}><RotateCw size={16} /></button>
        <button className="icon-btn" title="Tamaño del lienzo" aria-label="Tamaño del lienzo" onClick={() => setState({ dialog: 'resize' })}><Scaling size={16} /></button>
      </div>

      <div className="group">
        <button className="icon-btn" title="Alejar (-)" aria-label="Alejar" onClick={() => viewportApi.zoomBy(-1)}><ZoomOut size={16} /></button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" title="Acercar (+)" aria-label="Acercar" onClick={() => viewportApi.zoomBy(1)}><ZoomIn size={16} /></button>
        <button className="icon-btn" title="Ajustar a pantalla (0)" aria-label="Ajustar" onClick={() => viewportApi.fit()}><Maximize size={16} /></button>
        <button className={`icon-btn ${grid ? 'on' : ''}`} aria-pressed={grid} title="Cuadrícula (#)" aria-label="Cuadrícula" onClick={() => setState({ showGrid: !grid })}><Grid3x3 size={16} /></button>
      </div>

      <div className="spacer" />
      {!connected && <span className="conn-chip">Desconectado: reintentando…</span>}
      <ClaudeChip />
      <button className="icon-btn" title="Ayuda y conexión con Claude" aria-label="Ayuda" onClick={() => setState({ dialog: 'help' })}><HelpCircle size={16} /></button>
    </header>
  );
}

export function StatusBar() {
  const cursor = useStore((s) => s.cursor);
  const w = useStore((s) => s.doc?.width ?? 0);
  const h = useStore((s) => s.doc?.height ?? 0);
  const sel = useStore((s) => s.selection);
  const clients = useStore((s) => s.clients.length);
  const inside = cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x < w && cursor.y < h;
  return (
    <footer className="statusbar">
      <span>{w}×{h}px</span>
      <span>{inside ? `x ${cursor!.x}, y ${cursor!.y}` : '—'}</span>
      {sel && <span>Selección {sel.w}×{sel.h} en ({sel.x},{sel.y})</span>}
      <span className="spacer" />
      <span>{clients} {clients === 1 ? 'pestaña conectada' : 'pestañas conectadas'}</span>
    </footer>
  );
}
