import { spawn } from 'node:child_process';
import { Host, log } from './host';
import { editorUrl, getPort, HOST, RPC_HEADER, startServer, type RunningServer } from './http';

/**
 * The MCP process talks to the document through a Backend. If no openPixel
 * server is running it becomes the host itself (serving the editor); if one is
 * already running (e.g. `npm start` or another Claude window) it forwards calls
 * to it over HTTP.
 */
export interface Backend {
  mode: 'host' | 'remote';
  call<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Direct access when hosting in-process. */
  host?: Host;
}

let current: Backend | null = null;
let running: RunningServer | null = null;

async function remoteCall(method: string, params: unknown) {
  const res = await fetch(`http://${HOST}:${getPort()}/api/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [RPC_HEADER]: '1' },
    body: JSON.stringify({ method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result;
}

async function isOpenPixelRunning(): Promise<boolean> {
  try {
    const r = await fetch(`http://${HOST}:${getPort()}/api/health`, { signal: AbortSignal.timeout(1500) });
    const j = (await r.json()) as { app?: string };
    return j.app === 'openpixel';
  } catch {
    return false;
  }
}

const isConnRefused = (e: unknown) => {
  const err = e as { cause?: { code?: string }; code?: string };
  return err?.cause?.code === 'ECONNREFUSED' || err?.code === 'ECONNREFUSED' || String(e).includes('fetch failed');
};

async function connect(): Promise<Backend> {
  const host = new Host();
  try {
    running = await startServer(host, getPort());
    log('modo host: este proceso sirve el editor');
    return {
      mode: 'host',
      host,
      call: async (m, p) => host.rpc(m, p ?? {}) as any,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    if (!(await isOpenPixelRunning())) {
      throw new Error(`El puerto ${getPort()} está ocupado por otro programa. Usa la variable OPENPIXEL_PORT para elegir otro.`);
    }
    log('modo remoto: conectado al servidor openPixel existente');
    return {
      mode: 'remote',
      call: async (m, p) => remoteCall(m, p ?? {}) as any,
    };
  }
}

export async function getBackend(): Promise<Backend> {
  if (!current) current = await connect();
  return current;
}

/** Call a method, reconnecting once if a remote host went away. */
export async function call<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
  const b = await getBackend();
  try {
    return await b.call<T>(method, params);
  } catch (e) {
    if (b.mode === 'remote' && isConnRefused(e)) {
      current = null;
      const nb = await getBackend();
      return nb.call<T>(method, params);
    }
    throw e;
  }
}

export async function shutdown() {
  if (running) await running.close();
}

let opened = false;

/** Open the editor in the default browser (best effort). */
export function openBrowser(url = editorUrl()): boolean {
  if (process.env.OPENPIXEL_NO_BROWSER) return false;
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] :
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] :
    ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    opened = true;
    return true;
  } catch {
    return false;
  }
}

/** Open the editor once per process if no editor tab is connected yet. */
export async function ensureEditorOpen() {
  if (opened) return;
  try {
    const info = await call<{ editorsConnected: number }>('info');
    if (info.editorsConnected === 0) openBrowser();
    else opened = true;
  } catch {
    /* ignore */
  }
}
