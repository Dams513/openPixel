import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { WebSocket } from 'ws';
import { createDoc, Engine, serializeDoc, MAX_LAYERS } from '@openpixel/core';

const home = mkdtempSync(join(tmpdir(), 'openpixel-sec-'));
process.env.OPENPIXEL_HOME = join(home, 'data');
process.env.OPENPIXEL_ALLOWED_DIRS = join(home, 'files');
mkdirSync(join(home, 'files', '.secret'), { recursive: true });

const { safePath, originAllowed, hostAllowed } = await import('../src/security');
const { Host } = await import('../src/host');
const { startServer } = await import('../src/http');

const PORT = 46000 + Math.floor(Math.random() * 1000);
let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer(new Host(), PORT);
});
afterAll(async () => {
  await server.close();
});

function http(path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((ok, fail) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, method: opts.method ?? 'GET', headers: { host: `localhost:${PORT}`, ...opts.headers } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => ok({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', fail);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const rpc = (method: string, params: unknown, headers: Record<string, string> = {}) =>
  http('/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openpixel': '1', ...headers },
    body: JSON.stringify({ method, params }),
  });

describe('file path rules', () => {
  const files = join(home, 'files');
  it('allows images and projects inside the allowed folder', () => {
    expect(safePath(join(files, 'gato.png'), 'write')).toContain('gato.png');
    expect(safePath(join(files, 'sub', 'anim.gif'), 'write')).toContain('anim.gif');
  });
  it('rejects other extensions, outside folders and hidden folders', () => {
    expect(() => safePath(join(files, 'x.exe'), 'write')).toThrow(/Extensión/);
    expect(() => safePath(join(files, 'x'), 'write')).toThrow(/Extensión/);
    expect(() => safePath('/etc/passwd.png', 'write')).toThrow(/solo se pueden usar/);
    expect(() => safePath(join(files, '..', 'fuera.png'), 'write')).toThrow(/solo se pueden usar/);
    expect(() => safePath(join(files, '.secret', 'x.png'), 'write')).toThrow(/ocultas/);
    expect(() => safePath(join(files, 'x.png'), 'read')).toThrow(/Extensión/);
    expect(() => safePath(join(files, 'nada.opx'), 'read')).toThrow(/No existe/);
    expect(() => safePath('a\0b.png', 'write')).toThrow();
  });
});

describe('origin & host checks', () => {
  it('accepts only our own pages', () => {
    expect(originAllowed(undefined, 5577)).toBe(true);
    expect(originAllowed('http://localhost:5577', 5577)).toBe(true);
    expect(originAllowed('http://localhost:5173', 5577)).toBe(true);
    expect(originAllowed('http://localhost:3000', 5577)).toBe(false);
    expect(originAllowed('https://evil.com', 5577)).toBe(false);
    expect(originAllowed('null', 5577)).toBe(false);
    expect(hostAllowed('localhost:5577')).toBe(true);
    expect(hostAllowed('evil.com')).toBe(false);
  });
});

describe('live server', () => {
  it('sends security headers', async () => {
    const r = await http('/api/health');
    expect(r.status).toBe(200);
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(String(r.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('blocks DNS rebinding (foreign Host header)', async () => {
    expect((await http('/api/health', { headers: { host: 'attacker.example' } })).status).toBe(403);
  });

  it('blocks RPC from other websites and without the custom header', async () => {
    expect((await rpc('info', {}, { origin: 'https://evil.com' })).status).toBe(403);
    const noHeader = await http('/api/rpc', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"method":"info"}' });
    expect(noHeader.status).toBe(403);
    expect((await rpc('info', {})).status).toBe(200);
  });

  it('refuses to write outside the allowed folders', async () => {
    const r = JSON.parse((await rpc('export', { path: '/etc/openpixel-test.png' })).body);
    expect(r.error).toMatch(/solo se pueden usar/);
    const ok = JSON.parse((await rpc('export', { path: join(home, 'files', 'ok.png') })).body);
    expect(ok.result.path).toContain('ok.png');
  });

  it('rejects oversized documents', async () => {
    const e = new Engine(createDoc(8, 8));
    const doc = serializeDoc(e.doc);
    doc.layers = Array.from({ length: MAX_LAYERS + 1 }, (_, i) => ({ ...doc.layers[0], id: `l${i}` }));
    const r = JSON.parse((await rpc('apply', { ops: [{ type: 'load', doc }] })).body);
    expect(r.error).toMatch(/Demasiadas capas/);
    const big = { ...serializeDoc(createDoc(8, 8)), width: 1024, height: 1024, frames: Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, duration: 100 })) };
    expect(JSON.parse((await rpc('apply', { ops: [{ type: 'load', doc: big }] })).body).error).toMatch(/demasiado grande/);
  });

  it('rejects broken project files', async () => {
    const f = join(home, 'files', 'roto.opx');
    writeFileSync(f, 'esto no es json');
    expect(JSON.parse((await rpc('open', { path: f })).body).error).toMatch(/no es un proyecto/);
  });

  it('blocks path traversal on static files', async () => {
    for (const p of ['/../package.json', '/%2e%2e/%2e%2e/package.json', '/..%2f..%2fpackage.json', '/%00']) {
      const r = await http(p);
      expect(r.body).not.toContain('"workspaces"');
    }
  });

  it('rejects WebSocket connections from other origins', async () => {
    const result = (origin: string) => new Promise<string>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin, host: `localhost:${PORT}` } });
      ws.on('open', () => { ws.close(); ok('open'); });
      ws.on('error', () => ok('blocked'));
      ws.on('unexpected-response', () => ok('blocked'));
    });
    expect(await result('https://evil.com')).toBe('blocked');
    expect(await result(`http://localhost:${PORT}`)).toBe('open');
  });
});
