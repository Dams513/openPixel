import { useEffect } from 'react';
import { connect, useStore } from './store';
import { installShortcuts } from './actions';
import { Viewport } from './components/Viewport';
import { Toolbar, ToolOptions } from './components/Toolbar';
import { ColorPanel } from './components/ColorPanel';
import { LayersPanel } from './components/LayersPanel';
import { FramesPanel } from './components/FramesPanel';
import { StatusBar, TopBar } from './components/TopBar';
import { Dialogs, Toasts } from './components/Dialogs';

let started = false;

export function App() {
  const hasDoc = useStore((s) => !!s.doc);
  useEffect(() => {
    if (!started) {
      started = true;
      connect();
    }
    return installShortcuts();
  }, []);

  return (
    <div className="app">
      <TopBar />
      <ToolOptions />
      <div className="workspace">
        <Toolbar />
        <main className="stage">
          {hasDoc ? <Viewport /> : <div className="loading">Conectando con el servidor openPixel…</div>}
        </main>
        <aside className="sidebar">
          <ColorPanel />
          <LayersPanel />
        </aside>
      </div>
      <FramesPanel />
      <StatusBar />
      <Dialogs />
      <Toasts />
    </div>
  );
}
