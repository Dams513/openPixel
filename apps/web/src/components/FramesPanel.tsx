import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Layers2, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { compositePacked, packedToBytes } from '@openpixel/core';
import { getState, sendOps, setState, useStore } from '../store';
import { Thumb } from './Thumb';

/** Animated preview of all frames. */
function Preview() {
  const ref = useRef<HTMLCanvasElement>(null);
  const playing = useStore((s) => s.playing);
  const doc = useStore((s) => s.doc);
  const version = useStore((s) => s.version);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!playing || !doc) return;
    let i = 0;
    let t: number;
    const tick = () => {
      const d = getState().doc;
      if (!d) return;
      i = (i + 1) % d.frames.length;
      setShown(i);
      t = window.setTimeout(tick, d.frames[i]?.duration ?? 100);
    };
    t = window.setTimeout(tick, doc.frames[0]?.duration ?? 100);
    return () => clearTimeout(t);
  }, [playing, doc]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !doc) return;
    const f = playing ? Math.min(shown, doc.frames.length - 1) : doc.activeFrame;
    c.width = doc.width;
    c.height = doc.height;
    c.getContext('2d')!.putImageData(new ImageData(packedToBytes(compositePacked(doc, { frame: f })) as Uint8ClampedArray<ArrayBuffer>, doc.width, doc.height), 0, 0);
  }, [doc, version, shown, playing]);

  return <div className="preview"><canvas ref={ref} /></div>;
}

export function FramesPanel() {
  const doc = useStore((s) => s.doc);
  const version = useStore((s) => s.version);
  const playing = useStore((s) => s.playing);
  const onion = useStore((s) => s.onionSkin);
  if (!doc) return null;
  const cur = doc.frames[doc.activeFrame];
  const fps = Math.round(1000 / (cur?.duration || 100));

  return (
    <section className="frames">
      <Preview />
      <div className="frames-controls">
        <button className="icon-btn" aria-label={playing ? 'Pausar' : 'Reproducir'} title={playing ? 'Pausar' : 'Reproducir'} onClick={() => setState({ playing: !playing })}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="icon-btn" aria-label="Frame anterior" title="Frame anterior (,)" disabled={doc.activeFrame === 0} onClick={() => sendOps([{ type: 'select', frame: doc.activeFrame - 1 }])}><ChevronLeft size={14} /></button>
        <button className="icon-btn" aria-label="Frame siguiente" title="Frame siguiente (.)" disabled={doc.activeFrame >= doc.frames.length - 1} onClick={() => sendOps([{ type: 'select', frame: doc.activeFrame + 1 }])}><ChevronRight size={14} /></button>
        <button className="icon-btn" aria-label="Nuevo frame" title="Nuevo frame vacío" onClick={() => sendOps([{ type: 'addFrame' }])}><Plus size={14} /></button>
        <button className="icon-btn" aria-label="Duplicar frame" title="Duplicar frame" onClick={() => sendOps([{ type: 'addFrame', duplicate: true }])}><Copy size={14} /></button>
        <button className="icon-btn danger" aria-label="Borrar frame" title="Borrar frame" disabled={doc.frames.length <= 1} onClick={() => sendOps([{ type: 'deleteFrame' }])}><Trash2 size={14} /></button>
        <button className={`icon-btn ${onion ? 'on' : ''}`} aria-pressed={onion} title="Papel cebolla (ver frame anterior)" aria-label="Papel cebolla" onClick={() => setState({ onionSkin: !onion })}><Layers2 size={14} /></button>
        <label className="opt fps" title="Velocidad del frame actual">
          <input
            type="number"
            min={1}
            max={60}
            value={fps}
            onChange={(e) => {
              const v = Math.max(1, Math.min(60, Number(e.target.value) || 1));
              sendOps([{ type: 'updateFrame', duration: Math.round(1000 / v) }], `fps-${cur.id}`);
            }}
          />
          fps
        </label>
        <button
          className="text-btn"
          title="Aplicar esta velocidad a todos los frames"
          onClick={() => sendOps(doc.frames.map((_, i) => ({ type: 'updateFrame' as const, frame: i, duration: cur.duration })))}
        >
          a todos
        </button>
      </div>
      <ol className="frame-list">
        {doc.frames.map((f, i) => (
          <li key={f.id}>
            <button
              className={`frame ${i === doc.activeFrame ? 'active' : ''}`}
              onClick={() => sendOps([{ type: 'select', frame: i }])}
              title={`Frame ${i + 1} · ${f.duration} ms`}
              aria-label={`Frame ${i + 1}`}
            >
              <Thumb doc={doc} version={version} frame={i} size={44} />
              <span className="frame-num">{i + 1}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
