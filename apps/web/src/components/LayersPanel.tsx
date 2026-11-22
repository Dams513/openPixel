import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Lock, Merge, Plus, Trash2, Unlock } from 'lucide-react';
import { sendOps, useStore } from '../store';
import { Thumb } from './Thumb';

export function LayersPanel() {
  const doc = useStore((s) => s.doc);
  const version = useStore((s) => s.version);
  const [editing, setEditing] = useState<string | null>(null);
  if (!doc) return null;
  const active = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[doc.layers.length - 1];
  const activeIdx = doc.layers.indexOf(active);
  const list = [...doc.layers].reverse();

  return (
    <section className="panel layers">
      <header className="panel-head">
        <h2>Capas</h2>
        <div className="head-actions">
          <button className="icon-btn" title="Nueva capa" aria-label="Nueva capa" onClick={() => sendOps([{ type: 'addLayer' }])}><Plus size={14} /></button>
          <button className="icon-btn" title="Duplicar capa" aria-label="Duplicar capa" onClick={() => sendOps([{ type: 'duplicateLayer', layer: active.id }])}><Copy size={14} /></button>
          <button className="icon-btn" title="Subir" aria-label="Subir capa" disabled={activeIdx >= doc.layers.length - 1} onClick={() => sendOps([{ type: 'moveLayer', layer: active.id, index: activeIdx + 1 }])}><ArrowUp size={14} /></button>
          <button className="icon-btn" title="Bajar" aria-label="Bajar capa" disabled={activeIdx <= 0} onClick={() => sendOps([{ type: 'moveLayer', layer: active.id, index: activeIdx - 1 }])}><ArrowDown size={14} /></button>
          <button className="icon-btn" title="Combinar con la de abajo" aria-label="Combinar hacia abajo" disabled={activeIdx <= 0} onClick={() => sendOps([{ type: 'mergeDown', layer: active.id }])}><Merge size={14} /></button>
          <button className="icon-btn danger" title="Borrar capa" aria-label="Borrar capa" disabled={doc.layers.length <= 1} onClick={() => sendOps([{ type: 'deleteLayer', layer: active.id }])}><Trash2 size={14} /></button>
        </div>
      </header>
      <ul className="layer-list">
        {list.map((l) => (
          <li
            key={l.id}
            className={`layer ${l.id === active.id ? 'active' : ''} ${l.visible ? '' : 'hidden'}`}
            onClick={() => l.id !== active.id && sendOps([{ type: 'select', layer: l.id }])}
          >
            <button
              className="icon-btn ghost"
              aria-label={l.visible ? 'Ocultar capa' : 'Mostrar capa'}
              title={l.visible ? 'Ocultar' : 'Mostrar'}
              onClick={(e) => { e.stopPropagation(); sendOps([{ type: 'updateLayer', layer: l.id, visible: !l.visible }]); }}
            >
              {l.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <Thumb doc={doc} version={version} frame={doc.activeFrame} layerId={l.id} size={32} />
            {editing === l.id ? (
              <input
                className="layer-name-input"
                autoFocus
                defaultValue={l.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value !== l.name) sendOps([{ type: 'updateLayer', layer: l.id, name: e.target.value.trim() }]); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }}
              />
            ) : (
              <span className="layer-name" title="Doble clic para renombrar" onDoubleClick={() => setEditing(l.id)}>{l.name}</span>
            )}
            <button
              className="icon-btn ghost"
              aria-label={l.locked ? 'Desbloquear capa' : 'Bloquear capa'}
              title={l.locked ? 'Desbloquear' : 'Bloquear'}
              onClick={(e) => { e.stopPropagation(); sendOps([{ type: 'updateLayer', layer: l.id, locked: !l.locked }]); }}
            >
              {l.locked ? <Lock size={13} /> : <Unlock size={13} className="dim" />}
            </button>
          </li>
        ))}
      </ul>
      <label className="opt opacity">
        Opacidad
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(active.opacity * 100)}
          onChange={(e) => sendOps([{ type: 'updateLayer', layer: active.id, opacity: Number(e.target.value) / 100 }], `opacity-${active.id}`)}
        />
        <span className="num">{Math.round(active.opacity * 100)}%</span>
      </label>
    </section>
  );
}
