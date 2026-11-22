/**
 * Security helpers for the local server.
 *
 * openPixel only listens on 127.0.0.1, but two kinds of callers still need
 * limits:
 *  - Web pages open in the user's browser (CSRF, DNS rebinding, clickjacking).
 *  - The AI model, which could be manipulated by prompt injection into
 *    reading or writing files it should not touch.
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

export const WRITE_EXTENSIONS = new Set(['.png', '.gif', '.opx', '.json']);
export const READ_EXTENSIONS = new Set(['.opx', '.json']);
export const MAX_READ_BYTES = 64 * 1024 * 1024;

/** Folders where files may be read/written. Configurable with OPENPIXEL_ALLOWED_DIRS. */
export function allowedRoots(): string[] {
  const env = process.env.OPENPIXEL_ALLOWED_DIRS;
  const dirs = env ? env.split(delimiter).filter(Boolean) : [homedir(), tmpdir()];
  return dirs.map((d) => realpathOrSelf(resolve(expandHome(d))));
}

function expandHome(p: string) {
  return p.replace(/^~(?=$|[\\/])/, homedir());
}

function realpathOrSelf(p: string) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Resolve symlinks of the deepest existing ancestor so links cannot escape the allowed roots. */
function realTarget(abs: string) {
  let cur = abs;
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(basename(cur));
    cur = parent;
  }
  return resolve(realpathOrSelf(cur), ...rest);
}

const isInside = (child: string, root: string) => {
  const rel = relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * Validate a path coming from a tool call. Throws with a clear message when the
 * path is outside the allowed folders, inside a hidden/system folder, or has an
 * extension openPixel does not handle.
 */
export function safePath(input: unknown, mode: 'read' | 'write'): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Falta la ruta del archivo');
  if (input.includes('\0')) throw new Error('Ruta inválida');
  const abs = realTarget(resolve(expandHome(input.trim())));
  const ext = extname(abs).toLowerCase();
  const allowed = mode === 'write' ? WRITE_EXTENSIONS : READ_EXTENSIONS;
  if (!allowed.has(ext)) {
    throw new Error(`Extensión no permitida "${ext || '(ninguna)'}". Usa: ${[...allowed].join(', ')}`);
  }
  const roots = allowedRoots();
  // most specific root first (on Windows the temp folder lives inside the home folder)
  const root = roots.filter((r) => isInside(abs, r)).sort((a, b) => b.length - a.length)[0];
  if (!root) {
    throw new Error(`Por seguridad solo se pueden usar archivos dentro de: ${roots.join(', ')} (configurable con OPENPIXEL_ALLOWED_DIRS)`);
  }
  // Hidden folders (.ssh, .config…) and Windows AppData hold credentials and settings.
  const parts = relative(root, abs).split(sep).slice(0, -1);
  if (parts.some((p) => p.startsWith('.') || p.toLowerCase() === 'appdata')) {
    throw new Error('Por seguridad no se permiten carpetas ocultas ni AppData');
  }
  if (mode === 'read') {
    if (!existsSync(abs)) throw new Error(`No existe el archivo: ${abs}`);
    const st = statSync(abs);
    if (!st.isFile()) throw new Error('La ruta no es un archivo');
    if (st.size > MAX_READ_BYTES) throw new Error('El archivo es demasiado grande');
  } else if (existsSync(abs) && !statSync(abs).isFile()) {
    throw new Error('La ruta apunta a una carpeta');
  }
  return abs;
}

/** HTTP response headers applied to every response. */
export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

/** Only accept requests addressed to localhost (blocks DNS rebinding). */
export function hostAllowed(hostHeader: string | undefined): boolean {
  const h = (hostHeader ?? '').replace(/:\d+$/, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

/** Browser origins allowed to talk to the server: our own page (and the Vite dev server). */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (!origin) return true; // non-browser clients (the MCP process) send no Origin
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:') return false;
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false;
    const devPort = Number(process.env.OPENPIXEL_DEV_PORT) || 5173;
    const p = Number(u.port || 80);
    return p === port || p === devPort;
  } catch {
    return false;
  }
}

/** True when `file` is inside `root` (used for static files). */
export function insideRoot(file: string, root: string) {
  return file === root || file.startsWith(root.endsWith(sep) ? root : root + sep);
}
