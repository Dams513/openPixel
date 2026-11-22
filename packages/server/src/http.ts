import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { DEFAULT_PORT } from '@openpixel/core';
import { Host, log } from './host';
import { hostAllowed as hostOk, insideRoot, originAllowed as originOk, SECURITY_HEADERS } from './security';

export const RPC_HEADER = 'x-openpixel';
export const HOST = '127.0.0.1';

export function getPort() {
  return Number(process.env.OPENPIXEL_PORT) || DEFAULT_PORT;
}

export function editorUrl(port = getPort()) {
  return `http://localhost:${port}`;
}

function webDir() {
  if (process.env.OPENPIXEL_WEB_DIR) return resolve(process.env.OPENPIXEL_WEB_DIR);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../apps/web/dist');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const hostAllowed = (req: IncomingMessage) => hostOk(req.headers.host);
const originAllowed = (req: IncomingMessage, port: number) => originOk(req.headers.origin, port);
const MAX_CLIENTS = 32;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit = 32 * 1024 * 1024): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { fail(new Error('Cuerpo demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const root = webDir();
  if (!existsSync(join(root, 'index.html'))) {
    res.writeHead(503, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h1>openPixel</h1><p>El editor web no está compilado. Ejecuta <code>npm run build</code> en la carpeta del proyecto.</p>`);
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, SECURITY_HEADERS); res.end(); return;
  }
  if (pathname.includes('\0')) { res.writeHead(400, SECURITY_HEADERS); res.end(); return; }
  let file = normalize(join(root, pathname));
  if (!insideRoot(file, root)) { res.writeHead(403, SECURITY_HEADERS); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(readFileSync(file));
}

export interface RunningServer {
  server: Server;
  host: Host;
  port: number;
  close(): Promise<void>;
}

/** Start the HTTP + WebSocket server. Rejects with EADDRINUSE if taken. */
export function startServer(host: Host, port = getPort()): Promise<RunningServer> {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  wss.on('connection', (ws) => host.attach(ws));

  const server = createServer(async (req, res) => {
    if (!hostAllowed(req)) { res.writeHead(403, SECURITY_HEADERS); res.end('Host no permitido'); return; }
    if (!originAllowed(req, port)) return sendJson(res, 403, { error: 'Origen no permitido' });
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/api/health') {
      const mcpPath = resolve(dirname(fileURLToPath(import.meta.url)), 'mcp.js');
      return sendJson(res, 200, { app: 'openpixel', editors: host.editorCount(), mcpPath });
    }
    if (path === '/api/rpc') {
      // The custom header forces a CORS preflight that we never approve, so
      // other websites cannot call the RPC from a browser.
      const json = (req.headers['content-type'] ?? '').startsWith('application/json');
      if (req.method !== 'POST' || req.headers[RPC_HEADER] !== '1' || !json) return sendJson(res, 403, { error: 'Prohibido' });
      try {
        const { method, params } = JSON.parse(await readBody(req));
        const result = await host.rpc(method, params ?? {});
        return sendJson(res, 200, { result });
      } catch (e) {
        return sendJson(res, 200, { error: (e as Error).message });
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); res.end(); return; }
    serveStatic(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    if (!hostAllowed(req) || !originAllowed(req, port) || (req.url ?? '').split('?')[0] !== '/ws' || wss.clients.size >= MAX_CLIENTS) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, HOST, () => {
      server.off('error', fail);
      log(`editor en ${editorUrl(port)}`);
      ok({
        server,
        host,
        port,
        close: () => new Promise<void>((done) => {
          host.flushSave();
          for (const c of wss.clients) c.terminate();
          server.close(() => done());
        }),
      });
    });
  });
}
