import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Op } from '@openpixel/core';
import { call, ensureEditorOpen, openBrowser } from './backend';
import { editorUrl } from './http';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };

const layerRef = z.union([z.string(), z.number().int()]).optional()
  .describe('Capa destino: id, nombre o índice (0 = la de más abajo). Por defecto la capa activa.');
const frameRef = z.number().int().min(0).optional()
  .describe('Índice del frame de animación. Por defecto el frame activo.');
const color = z.string().nullable()
  .describe('Color "#rrggbb" o "#rrggbbaa" (también "#rgb"). null o "transparent" borra.');
const preview = z.boolean().optional()
  .describe('Si es true, devuelve además una imagen del lienzo tras dibujar (ahorra una llamada a view_canvas).');

const target = { layer: layerRef, frame: frameRef };

async function guard(fn: () => Promise<Result>): Promise<Result> {
  try {
    return await fn();
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
  }
}

async function viewContent(opts: Record<string, unknown> = {}): Promise<Content[]> {
  const img = await call<{ base64: string; scale: number }>('image', opts);
  const info = await call<{ width: number; height: number }>('info');
  return [
    { type: 'image', data: img.base64, mimeType: 'image/png' },
    {
      type: 'text',
      text: `Lienzo ${info.width}x${info.height} px mostrado a escala ${img.scale}x. Las líneas de cuadrícula marcan cada píxel; las más fuertes, cada 8 píxeles desde (0,0). El damero gris/blanco indica transparencia.`,
    },
  ];
}

async function draw(ops: Op[], label: string, wantPreview?: boolean): Promise<Result> {
  return guard(async () => {
    await ensureEditorOpen();
    const r = await call<{ changed: boolean; pixelsChanged: number; bounds: { x: number; y: number; w: number; h: number } | null }>(
      'apply',
      { ops, label },
    );
    const b = r.bounds;
    const text = r.changed
      ? `OK (${label}): ${r.pixelsChanged} píxeles cambiados${b ? ` en x=${b.x}..${b.x + b.w - 1}, y=${b.y}..${b.y + b.h - 1}` : ''}.`
      : `OK (${label}): sin cambios en los píxeles.`;
    const content: Content[] = [{ type: 'text', text }];
    if (wantPreview) content.push(...(await viewContent()));
    return { content };
  });
}

const text = (t: unknown): Result => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });

export const INSTRUCTIONS = `openPixel es un editor de pixel art que el usuario ve en vivo en su navegador (${editorUrl()}). Todo lo que dibujes aparece al instante y el usuario puede deshacerlo con Ctrl+Z.

Flujo recomendado:
1. get_canvas_info para ver tamaño, capas y paleta (o new_canvas para empezar uno nuevo, p.ej. 32x32 o 64x64).
2. Para sprites usa draw_grid: escribe el dibujo como filas de caracteres con un "legend" de colores; es lo más rápido y preciso. "." deja el píxel sin tocar.
3. Usa draw_rect / draw_ellipse / draw_line / fill para formas grandes y fondos.
4. Organiza en capas (layer action=add) — p.ej. fondo, contorno, color, sombras — para poder corregir sin destruir.
5. Revisa tu trabajo con view_canvas (devuelve una imagen) y corrige. read_pixels devuelve el área como texto en el mismo formato que draw_grid.
6. batch permite enviar muchas operaciones en una sola llamada (y un solo paso de deshacer).
Coordenadas: (0,0) es la esquina superior izquierda; x crece a la derecha, y hacia abajo. Consejos de pixel art: contornos de 1px, paleta limitada, sombras con tonos más oscuros y fríos, luces más claras y cálidas, evita líneas "dentadas" irregulares.`;

export function registerTools(server: McpServer) {
  server.registerTool('open_editor', {
    description: 'Abre el editor openPixel en el navegador del usuario para que vea el dibujo en vivo. Devuelve la URL.',
    inputSchema: {},
  }, async () => guard(async () => {
    await call('info');
    const ok = openBrowser();
    return text(ok ? `Editor abierto: ${editorUrl()}` : `Abre ${editorUrl()} en el navegador.`);
  }));

  server.registerTool('get_canvas_info', {
    description: 'Devuelve el estado del documento: tamaño, capas (índice, nombre, visibilidad, opacidad, píxeles usados), frames de animación, paleta y si hay editores conectados.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => guard(async () => text(await call('info'))));

  server.registerTool('view_canvas', {
    description: 'Devuelve una imagen PNG ampliada del lienzo (todas las capas visibles combinadas) con cuadrícula, para que puedas ver lo que hay dibujado. Úsala a menudo para revisar tu trabajo.',
    inputSchema: {
      scale: z.number().int().min(1).max(32).optional().describe('Ampliación; por defecto se ajusta a ~512px.'),
      grid: z.boolean().optional().describe('Dibujar cuadrícula de píxeles (por defecto true).'),
      layer: z.union([z.string(), z.number().int()]).optional().describe('Mostrar solo esta capa.'),
      frame: frameRef,
      region: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().min(1), h: z.number().int().min(1) }).optional()
        .describe('Recortar a una zona para verla con más detalle.'),
    },
    annotations: { readOnlyHint: true },
  }, async (a) => guard(async () => ({ content: await viewContent(a) })));

  server.registerTool('read_pixels', {
    description: 'Lee una zona como texto: filas de caracteres + legend (char → color), "." = transparente. Es el mismo formato que acepta draw_grid, así que puedes leer, modificar y reescribir. Sin "layer" lee la imagen combinada.',
    inputSchema: {
      x: z.number().int().min(0).optional(),
      y: z.number().int().min(0).optional(),
      width: z.number().int().min(1).optional(),
      height: z.number().int().min(1).optional(),
      layer: z.union([z.string(), z.number().int()]).optional(),
      frame: frameRef,
    },
    annotations: { readOnlyHint: true },
  }, async (a) => guard(async () => text(await call('pixels', { x: a.x, y: a.y, w: a.width, h: a.height, layer: a.layer, frame: a.frame }))));

  server.registerTool('new_canvas', {
    description: 'Crea un lienzo nuevo (reemplaza el actual; se puede deshacer). Tamaños típicos: 16, 32, 64, 128.',
    inputSchema: {
      width: z.number().int().min(1).max(1024),
      height: z.number().int().min(1).max(1024),
      background: z.string().nullable().optional().describe('Color de fondo; por defecto transparente.'),
      name: z.string().optional(),
    },
  }, async (a) => guard(async () => {
    await ensureEditorOpen();
    return text(await call('new', a));
  }));

  server.registerTool('draw_grid', {
    description: `Dibuja un bloque de píxeles a partir de texto. Cada string de "rows" es una fila; cada carácter es un píxel y se traduce con "legend".
Ejemplo (corazón 7x6 en x=4,y=4):
rows: [".rr.rr.", "rrrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."], legend: {"r": "#e03050"}
Caracteres en "skip" (por defecto "." y espacio) dejan el píxel como estaba. Para borrar usa un carácter con valor null en legend.`,
    inputSchema: {
      x: z.number().int().describe('Columna donde empieza la primera fila.'),
      y: z.number().int().describe('Fila donde empieza el bloque.'),
      rows: z.array(z.string()).min(1),
      legend: z.record(z.string(), z.string().nullable()).describe('Mapa carácter → color (o null para borrar).'),
      skip: z.string().optional().describe('Caracteres que no pintan (por defecto ". ").'),
      ...target,
      preview,
    },
  }, async (a) => draw([{ type: 'grid', x: a.x, y: a.y, rows: a.rows, legend: a.legend, skip: a.skip, layer: a.layer, frame: a.frame }], 'draw_grid', a.preview));

  server.registerTool('draw_pixels', {
    description: 'Pinta píxeles sueltos. Útil para retoques puntuales.',
    inputSchema: {
      pixels: z.array(z.object({ x: z.number().int(), y: z.number().int(), color })).min(1),
      ...target,
      preview,
    },
  }, async (a) => draw([{ type: 'pixels', pixels: a.pixels.map((p) => [p.x, p.y, p.color] as [number, number, string | null]), layer: a.layer, frame: a.frame }], 'draw_pixels', a.preview));

  server.registerTool('draw_line', {
    description: 'Dibuja una línea pixel-perfect (Bresenham) entre dos puntos, ambos incluidos.',
    inputSchema: {
      x1: z.number().int(), y1: z.number().int(), x2: z.number().int(), y2: z.number().int(),
      color,
      size: z.number().int().min(1).max(64).optional().describe('Grosor del pincel (cuadrado). Por defecto 1.'),
      ...target,
      preview,
    },
  }, async (a) => draw([{ type: 'line', x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, color: a.color, size: a.size, layer: a.layer, frame: a.frame }], 'draw_line', a.preview));

  server.registerTool('draw_rect', {
    description: 'Dibuja un rectángulo (contorno o relleno). x,y es la esquina superior izquierda.',
    inputSchema: {
      x: z.number().int(), y: z.number().int(),
      width: z.number().int().min(1), height: z.number().int().min(1),
      color,
      filled: z.boolean().optional(),
      thickness: z.number().int().min(1).optional().describe('Grosor del contorno (si no está relleno).'),
      ...target,
      preview,
    },
  }, async (a) => draw([{ type: 'rect', x: a.x, y: a.y, w: a.width, h: a.height, color: a.color, filled: a.filled, thickness: a.thickness, layer: a.layer, frame: a.frame }], 'draw_rect', a.preview));

  server.registerTool('draw_ellipse', {
    description: 'Dibuja una elipse/círculo inscrito en el rectángulo x,y,width,height (contorno o relleno). Para un círculo de diámetro d centrado en (cx,cy): x=cx-floor(d/2), y=cy-floor(d/2), width=height=d.',
    inputSchema: {
      x: z.number().int(), y: z.number().int(),
      width: z.number().int().min(1), height: z.number().int().min(1),
      color,
      filled: z.boolean().optional(),
      ...target,
      preview,
    },
  }, async (a) => draw([{ type: 'ellipse', x: a.x, y: a.y, w: a.width, h: a.height, color: a.color, filled: a.filled, layer: a.layer, frame: a.frame }], 'draw_ellipse', a.preview));

  server.registerTool('fill', {
    description: 'Bote de pintura: rellena la zona contigua del mismo color que (x,y). Con contiguous=false cambia todos los píxeles de ese color en la capa.',
    inputSchema: {
      x: z.number().int(), y: z.number().int(),
      color,
      contiguous: z.boolean().optional(),
      ...target,
      preview,
    },
  }, async (a) => draw([{ type: 'fill', x: a.x, y: a.y, color: a.color, contiguous: a.contiguous, layer: a.layer, frame: a.frame }], 'fill', a.preview));

  server.registerTool('replace_color', {
    description: 'Reemplaza un color exacto por otro en la capa (o en todas las capas con all_layers).',
    inputSchema: {
      from: color, to: color,
      all_layers: z.boolean().optional(),
      ...target,
      preview,
    },
  }, async (a) => draw([{ type: 'replaceColor', from: a.from, to: a.to, allLayers: a.all_layers, layer: a.layer, frame: a.frame }], 'replace_color', a.preview));

  server.registerTool('clear', {
    description: 'Borra (deja transparente) toda la capa o un rectángulo de ella.',
    inputSchema: {
      x: z.number().int().optional(), y: z.number().int().optional(),
      width: z.number().int().min(1).optional(), height: z.number().int().min(1).optional(),
      ...target,
      preview,
    },
  }, async (a) => draw([{ type: 'clear', x: a.x, y: a.y, w: a.width, h: a.height, layer: a.layer, frame: a.frame }], 'clear', a.preview));

  server.registerTool('transform_layer', {
    description: 'Transforma el contenido de una capa: voltear, rotar o desplazar.',
    inputSchema: {
      action: z.enum(['flip_horizontal', 'flip_vertical', 'rotate_cw', 'rotate_ccw', 'rotate_180', 'shift']),
      dx: z.number().int().optional().describe('Para shift: desplazamiento horizontal.'),
      dy: z.number().int().optional().describe('Para shift: desplazamiento vertical.'),
      wrap: z.boolean().optional().describe('Para shift: lo que sale por un borde entra por el otro.'),
      ...target,
      preview,
    },
  }, async (a) => {
    const t = { layer: a.layer, frame: a.frame };
    const op: Op =
      a.action === 'flip_horizontal' ? { type: 'flip', axis: 'h', ...t } :
      a.action === 'flip_vertical' ? { type: 'flip', axis: 'v', ...t } :
      a.action === 'rotate_cw' ? { type: 'rotate', dir: 'cw', ...t } :
      a.action === 'rotate_ccw' ? { type: 'rotate', dir: 'ccw', ...t } :
      a.action === 'rotate_180' ? { type: 'rotate', dir: '180', ...t } :
      { type: 'shift', dx: a.dx ?? 0, dy: a.dy ?? 0, wrap: a.wrap, ...t };
    return draw([op], a.action, a.preview);
  });

  server.registerTool('move_region', {
    description: 'Mueve (o copia con copy=true) un rectángulo de píxeles de la capa dx,dy posiciones.',
    inputSchema: {
      x: z.number().int(), y: z.number().int(),
      width: z.number().int().min(1), height: z.number().int().min(1),
      dx: z.number().int(), dy: z.number().int(),
      copy: z.boolean().optional(),
      ...target,
      preview,
    },
  }, async (a) => draw([{ type: 'moveRegion', x: a.x, y: a.y, w: a.width, h: a.height, dx: a.dx, dy: a.dy, copy: a.copy, layer: a.layer, frame: a.frame }], 'move_region', a.preview));

  server.registerTool('layer', {
    description: `Gestiona capas. Acciones:
- add: crea capa (name, index opcional) y la activa
- duplicate, delete, merge_down (combina con la de abajo)
- update: cambia name / visible / opacity (0..1) / locked
- move: mueve a "index" (0 = abajo)
- select: la hace activa (los dibujos sin "layer" van a la activa)`,
    inputSchema: {
      action: z.enum(['add', 'duplicate', 'delete', 'update', 'move', 'merge_down', 'select']),
      layer: z.union([z.string(), z.number().int()]).optional().describe('Capa objetivo (id, nombre o índice). Por defecto la activa.'),
      name: z.string().optional(),
      visible: z.boolean().optional(),
      opacity: z.number().min(0).max(1).optional(),
      locked: z.boolean().optional(),
      index: z.number().int().min(0).optional(),
    },
  }, async (a) => {
    const op: Op =
      a.action === 'add' ? { type: 'addLayer', name: a.name, index: a.index } :
      a.action === 'duplicate' ? { type: 'duplicateLayer', layer: a.layer } :
      a.action === 'delete' ? { type: 'deleteLayer', layer: a.layer } :
      a.action === 'update' ? { type: 'updateLayer', layer: a.layer, name: a.name, visible: a.visible, opacity: a.opacity, locked: a.locked } :
      a.action === 'move' ? { type: 'moveLayer', layer: a.layer, index: a.index ?? 0 } :
      a.action === 'merge_down' ? { type: 'mergeDown', layer: a.layer } :
      { type: 'select', layer: a.layer };
    const r = await draw([op], `layer ${a.action}`);
    if (r.isError) return r;
    const info = await call<{ layers: unknown[] }>('info');
    return text({ ok: true, layers: info.layers });
  });

  server.registerTool('frame', {
    description: `Gestiona frames de animación. Acciones:
- add: frame vacío después del activo (o en "index") y lo activa
- duplicate: copia el frame activo (ideal para animar cambiando poco)
- delete, move (a "index"), select, set_duration (ms)`,
    inputSchema: {
      action: z.enum(['add', 'duplicate', 'delete', 'move', 'select', 'set_duration']),
      frame: frameRef,
      index: z.number().int().min(0).optional(),
      duration: z.number().int().min(10).max(10000).optional(),
    },
  }, async (a) => {
    const op: Op =
      a.action === 'add' ? { type: 'addFrame', index: a.index } :
      a.action === 'duplicate' ? { type: 'addFrame', duplicate: true, index: a.index } :
      a.action === 'delete' ? { type: 'deleteFrame', frame: a.frame } :
      a.action === 'move' ? { type: 'moveFrame', frame: a.frame, index: a.index ?? 0 } :
      a.action === 'set_duration' ? { type: 'updateFrame', frame: a.frame, duration: a.duration ?? 100 } :
      { type: 'select', frame: a.frame ?? 0 };
    const r = await draw([op], `frame ${a.action}`);
    if (r.isError) return r;
    const info = await call<{ frames: unknown[]; activeFrame: number }>('info');
    return text({ ok: true, activeFrame: info.activeFrame, frames: info.frames });
  });

  server.registerTool('set_palette', {
    description: 'Reemplaza la paleta de colores que ve el usuario en el editor (no cambia píxeles).',
    inputSchema: { colors: z.array(z.string()).min(1).max(256) },
  }, async (a) => draw([{ type: 'setPalette', colors: a.colors }], 'set_palette'));

  server.registerTool('resize_canvas', {
    description: 'Cambia el tamaño del lienzo sin escalar los píxeles (recorta o añade espacio). anchor indica qué parte se conserva fija.',
    inputSchema: {
      width: z.number().int().min(1).max(1024),
      height: z.number().int().min(1).max(1024),
      anchor: z.enum(['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']).optional(),
    },
  }, async (a) => draw([{ type: 'resize', width: a.width, height: a.height, anchor: a.anchor }], 'resize_canvas'));

  server.registerTool('batch', {
    description: `Ejecuta varias operaciones en una sola llamada (atómico: si una falla no se aplica ninguna; un solo paso de deshacer).
Cada op es un objeto con "type" y sus campos (layer/frame opcionales en todas las de píxeles):
- {type:"grid", x, y, rows:[...], legend:{char:color}, skip?}
- {type:"pixels", pixels:[[x,y,color],...]}
- {type:"line", x1,y1,x2,y2, color, size?}
- {type:"rect", x,y,w,h, color, filled?, thickness?}
- {type:"ellipse", x,y,w,h, color, filled?}
- {type:"fill", x,y, color, contiguous?}
- {type:"replaceColor", from, to, allLayers?}
- {type:"clear", x?,y?,w?,h?}
- {type:"flip", axis:"h"|"v"} · {type:"rotate", dir:"cw"|"ccw"|"180"} · {type:"shift", dx, dy, wrap?}
- {type:"moveRegion", x,y,w,h, dx,dy, copy?}
- {type:"addLayer", name?, index?} · {type:"updateLayer", layer, name?, visible?, opacity?, locked?} · {type:"deleteLayer", layer} · {type:"select", layer?, frame?}
- {type:"addFrame", duplicate?, index?} · {type:"updateFrame", frame, duration}`,
    inputSchema: {
      ops: z.array(z.looseObject({ type: z.string() })).min(1),
      label: z.string().optional().describe('Descripción corta que verá el usuario en el historial.'),
      preview,
    },
  }, async (a) => draw(a.ops as unknown as Op[], a.label ?? 'batch', a.preview));

  server.registerTool('undo', {
    description: 'Deshace el último cambio (de cualquiera: el usuario o tú).',
    inputSchema: { steps: z.number().int().min(1).max(100).optional() },
  }, async (a) => guard(async () => {
    const out = [];
    for (let i = 0; i < (a.steps ?? 1); i++) {
      const r = await call('undo');
      if (!r) break;
      out.push(r);
    }
    return text(out.length ? { undone: out } : 'Nada que deshacer.');
  }));

  server.registerTool('redo', {
    description: 'Rehace el último cambio deshecho.',
    inputSchema: { steps: z.number().int().min(1).max(100).optional() },
  }, async (a) => guard(async () => {
    const out = [];
    for (let i = 0; i < (a.steps ?? 1); i++) {
      const r = await call('redo');
      if (!r) break;
      out.push(r);
    }
    return text(out.length ? { redone: out } : 'Nada que rehacer.');
  }));

  server.registerTool('export_file', {
    description: 'Guarda el trabajo en disco. La extensión decide el formato: .png (imagen del frame actual), .gif (animación con todos los frames), .opx (proyecto openPixel completo con capas y frames).',
    inputSchema: {
      path: z.string().describe('Ruta del archivo, p.ej. "~/Desktop/sprite.png".'),
      scale: z.number().int().min(1).max(64).optional().describe('Ampliación para png/gif (p.ej. 10 para 32px → 320px).'),
      layer: z.union([z.string(), z.number().int()]).optional().describe('Solo png: exportar una sola capa.'),
      frame: frameRef,
    },
  }, async (a) => guard(async () => text(await call('export', a))));

  server.registerTool('open_file', {
    description: 'Abre un proyecto .opx guardado (reemplaza el documento actual; se puede deshacer).',
    inputSchema: { path: z.string() },
  }, async (a) => guard(async () => text(await call('open', a))));

  server.registerTool('show_status', {
    description: 'Muestra un mensaje corto en el editor del usuario (p.ej. "Dibujando el contorno…") para que sepa qué estás haciendo.',
    inputSchema: { message: z.string().max(200) },
  }, async (a) => guard(async () => {
    await call('activity', { message: a.message });
    return text('Mostrado.');
  }));
}
