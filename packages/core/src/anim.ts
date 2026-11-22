/**
 * Procedural animation presets. They take a sprite (the non-transparent pixels
 * of one layer) and produce a sequence of transformed frames: squash & stretch,
 * bobbing, leg scissoring, jumps, spins…
 */
import { TRANSPARENT } from './color';

export const ANIM_PRESETS = ['idle', 'walk', 'run', 'jump', 'bounce', 'float', 'shake', 'spin', 'pulse', 'attack', 'hurt'] as const;
export type AnimPreset = (typeof ANIM_PRESETS)[number];

export const ANIM_INFO: Record<AnimPreset, { label: string; frames: number; duration: number; description: string }> = {
  idle: { label: 'Reposo (respirar)', frames: 4, duration: 220, description: 'respiración suave: se aplasta 1-2px y vuelve' },
  walk: { label: 'Caminar', frames: 4, duration: 150, description: 'piernas en tijera + balanceo vertical' },
  run: { label: 'Correr', frames: 4, duration: 95, description: 'zancada amplia, inclinación hacia delante y rebote' },
  jump: { label: 'Saltar', frames: 8, duration: 90, description: 'anticipación (aplastar), estirar al subir, arco, aterrizaje' },
  bounce: { label: 'Rebotar', frames: 6, duration: 100, description: 'rebote tipo pelota/slime con squash & stretch' },
  float: { label: 'Flotar', frames: 8, duration: 120, description: 'sube y baja suavemente (onda seno)' },
  shake: { label: 'Temblar', frames: 6, duration: 50, description: 'vibra de lado a lado' },
  spin: { label: 'Girar', frames: 8, duration: 90, description: 'gira sobre su eje vertical (se voltea)' },
  pulse: { label: 'Latir', frames: 6, duration: 100, description: 'crece y se encoge (corazón, objeto mágico)' },
  attack: { label: 'Atacar', frames: 5, duration: 80, description: 'retrocede para tomar impulso y embiste hacia delante' },
  hurt: { label: 'Recibir daño', frames: 4, duration: 80, description: 'retroceso con parpadeo' },
};

export interface AnimOptions {
  /** Pixel amplitude (jump height, bob, shake…). Default scales with sprite size. */
  intensity?: number;
  /** Direction the sprite faces (affects lean, run, attack). Default right. */
  facing?: 'right' | 'left';
  /** 0..1 — where the legs start, as a fraction of sprite height from the top. Default 0.65. */
  legSplit?: number;
}

interface FrameXform {
  dx?: number;
  dy?: number;
  /** Scale factors around the bottom-centre of the sprite. Negative sx mirrors. */
  sx?: number;
  sy?: number;
  /** Horizontal shift of the top row relative to the bottom (lean). */
  lean?: number;
  /** Leg scissor amount: front leg forward, back leg backward. */
  legs?: number;
  /** Vertical offset applied only to the body (rows above the legs). */
  bodyDy?: number;
  /** Make the sprite invisible (blink) */
  hidden?: boolean;
}

interface Box { x: number; y: number; w: number; h: number }

function bbox(cel: Uint32Array, width: number, height: number): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (cel[y * width + x] === TRANSPARENT) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function plan(preset: AnimPreset, b: Box, o: AnimOptions): FrameXform[] {
  const f = o.facing === 'left' ? -1 : 1;
  const h = b.h, w = b.w;
  const px = (n: number, base: number) => Math.max(1, Math.round(n ?? base));
  const sq = (k: number) => ({ sy: (h - k) / h, sx: (w + k) / w });
  // Stretch is vertical only: narrowing small sprites drops columns (eyes, outlines).
  const st = (k: number) => ({ sy: (h + k) / h });
  switch (preset) {
    case 'idle': {
      const k = px(o.intensity!, h * 0.06);
      return [{}, sq(Math.ceil(k / 2)), sq(k), sq(Math.ceil(k / 2))];
    }
    case 'walk': {
      const s = px(o.intensity!, w * 0.1);
      // Contact frames: legs apart, body low. Passing frames: legs together, body high.
      return [{ legs: s, bodyDy: 1 }, {}, { legs: -s, bodyDy: 1 }, {}];
    }
    case 'run': {
      const s = px(o.intensity!, w * 0.16);
      const b2 = Math.max(1, Math.round(h * 0.08));
      return [
        { legs: Math.round(s * 1.5), lean: f, bodyDy: 1 },
        { lean: f, dy: -b2 },
        { legs: -Math.round(s * 1.5), lean: f, bodyDy: 1 },
        { lean: f, dy: -b2 },
      ];
    }
    case 'jump': {
      const H = px(o.intensity!, h * 0.6);
      const a = Math.max(1, Math.round(h * 0.14));
      return [
        sq(a),
        { ...st(a), dy: -Math.round(H * 0.3) },
        { ...st(Math.ceil(a / 2)), dy: -Math.round(H * 0.75) },
        { dy: -H },
        { dy: -Math.round(H * 0.95) },
        { dy: -Math.round(H * 0.7) },
        { ...st(Math.ceil(a / 2)), dy: -Math.round(H * 0.3) },
        sq(a),
      ];
    }
    case 'bounce': {
      const H = px(o.intensity!, h * 0.45);
      const a = Math.max(1, Math.round(h * 0.2));
      return [sq(a), { ...st(a), dy: -Math.round(H * 0.6) }, { dy: -H }, { dy: -H }, { ...st(Math.ceil(a / 2)), dy: -Math.round(H * 0.6) }, sq(Math.ceil(a / 2))];
    }
    case 'float': {
      const A = px(o.intensity!, h * 0.1);
      return Array.from({ length: 8 }, (_, i) => ({ dy: -Math.round(Math.sin((i / 8) * Math.PI * 2) * A) }));
    }
    case 'shake': {
      const A = px(o.intensity!, 1);
      return [{}, { dx: A }, { dx: -A }, { dx: A }, { dx: -A }, {}];
    }
    case 'spin':
      return Array.from({ length: 8 }, (_, i) => {
        const c = Math.cos((i / 8) * Math.PI * 2);
        const sx = Math.abs(c) < 1 / w ? (c < 0 ? -1 : 1) / w : c;
        return { sx };
      });
    case 'pulse': {
      const k = (o.intensity ?? Math.max(1, Math.round(Math.min(w, h) * 0.12))) / Math.max(w, h);
      return [0, 0.5, 1, 0.5, 0, -0.4].map((t) => ({ sx: 1 + k * t, sy: 1 + k * t }));
    }
    case 'attack': {
      const A = px(o.intensity!, w * 0.25);
      return [{}, { dx: -f * Math.ceil(A / 3), lean: -f, ...sq(1) }, { dx: f * A, lean: f * 2, ...st(1) }, { dx: f * Math.round(A * 0.6), lean: f }, {}];
    }
    case 'hurt': {
      const A = px(o.intensity!, w * 0.12);
      return [{ dx: -f * A, hidden: false }, { dx: -f * A, hidden: true }, { dx: -f * Math.ceil(A / 2) }, {}];
    }
  }
}

/**
 * Render one transformed copy of the sprite (source cel, full canvas size)
 * into a new full-size cel. Uses inverse nearest-neighbour mapping so there
 * are no holes when stretching.
 */
function renderFrame(src: Uint32Array, width: number, height: number, b: Box, t: FrameXform, legSplit: number): Uint32Array {
  const out = new Uint32Array(width * height);
  if (t.hidden) return out;
  const sx = t.sx ?? 1, sy = t.sy ?? 1, dx = t.dx ?? 0, dy = t.dy ?? 0, lean = t.lean ?? 0, legs = t.legs ?? 0, bodyDy = t.bodyDy ?? 0;
  const base = b.y + b.h; // baseline (bottom edge)
  const cx = b.x + b.w / 2;
  const legTop = b.y + b.h * legSplit;
  const sample = (fx: number, fy: number) => {
    const ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix < b.x || iy < b.y || ix >= b.x + b.w || iy >= b.y + b.h) return TRANSPARENT;
    return src[iy * width + ix];
  };
  const unscale = (v: number) => cx + (v - cx) / sx;
  /** Sample the sprite at destination (x,y) for a given extra vertical offset. part: rows above/below legTop. */
  const at = (x: number, y: number, extraDy: number, part: 'body' | 'legs' | 'all') => {
    const yl = y + 0.5 - dy - extraDy;
    const fy = base - (base - yl) / sy;
    if (fy < b.y || fy >= base) return TRANSPARENT;
    const isLeg = fy >= legTop;
    if ((part === 'body' && isLeg) || (part === 'legs' && !isLeg)) return TRANSPARENT;
    const xl = x + 0.5 - dx - lean * ((base - fy) / b.h);
    if (legs && isLeg) {
      // Front half moves +legs, back half moves -legs.
      const a = unscale(xl - legs), bb = unscale(xl + legs);
      const ca = a >= cx ? sample(a, fy) : TRANSPARENT;
      return ca !== TRANSPARENT ? ca : bb < cx ? sample(bb, fy) : TRANSPARENT;
    }
    return sample(unscale(xl), fy);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let c: number;
    if (bodyDy) {
      c = at(x, y, bodyDy, 'body');
      if (c === TRANSPARENT) c = at(x, y, 0, 'legs');
    } else {
      c = at(x, y, 0, 'all');
    }
    if (c !== TRANSPARENT) out[y * width + x] = c;
  }
  return out;
}

export interface GeneratedAnimation {
  cels: Uint32Array[];
  durations: number[];
}

export function animationFrameCount(preset: AnimPreset): number {
  return ANIM_INFO[preset]?.frames ?? 0;
}

export function generateAnimation(
  src: Uint32Array,
  width: number,
  height: number,
  preset: AnimPreset,
  opts: AnimOptions = {},
  duration?: number,
): GeneratedAnimation {
  if (!ANIM_INFO[preset]) throw new Error(`Animación desconocida "${preset}". Opciones: ${ANIM_PRESETS.join(', ')}`);
  const b = bbox(src, width, height);
  if (!b) throw new Error('La capa está vacía en ese frame: no hay sprite que animar');
  const steps = plan(preset, b, opts);
  const legSplit = Math.min(0.95, Math.max(0.2, opts.legSplit ?? 0.65));
  const d = duration ?? ANIM_INFO[preset].duration;
  return {
    cels: steps.map((t) => renderFrame(src, width, height, b, t, legSplit)),
    durations: steps.map(() => d),
  };
}
