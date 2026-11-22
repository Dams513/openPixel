# openPixel

Editor de pixel art **local** en el navegador, con un servidor **MCP** para que Claude dibuje contigo en tiempo real: tú ves cada trazo al instante y puedes deshacerlo con Ctrl+Z.

```
Claude ──MCP (stdio)──▶ servidor openPixel (Node) ──WebSocket──▶ editor en el navegador
```

## Instalación

Requiere Node.js 20 o superior.

```bash
npm install
npm run build
```

## Usar el editor

```bash
npm start
```

Abre <http://localhost:5577>. El dibujo se autoguarda en `~/.openpixel/autosave.opx`.

## Conectar Claude

El servidor MCP está en `packages/server/dist/mcp.js` (ruta absoluta). El botón **?** del editor muestra la ruta exacta con un botón para copiarla.

**Claude Code**

```bash
claude mcp add openpixel -- node /RUTA/ABSOLUTA/openPixel/packages/server/dist/mcp.js
```

**Claude Desktop** (Ajustes → Desarrollador → Editar configuración):

```json
{
  "mcpServers": {
    "openpixel": {
      "command": "node",
      "args": ["/RUTA/ABSOLUTA/openPixel/packages/server/dist/mcp.js"]
    }
  }
}
```

Si el editor no está abierto, el proceso MCP lo levanta solo y abre el navegador la primera vez que Claude dibuja. Si ya está abierto (`npm start`), se conecta a él.

Variables opcionales: `OPENPIXEL_PORT` (puerto, 5577 por defecto), `OPENPIXEL_HOME` (carpeta de autoguardado), `OPENPIXEL_NO_BROWSER=1` (no abrir el navegador).

### Herramientas MCP

| Herramienta | Para qué sirve |
|---|---|
| `get_canvas_info` | Tamaño, capas, frames y paleta |
| `view_canvas` | Imagen PNG ampliada con cuadrícula, para que Claude vea el dibujo |
| `read_pixels` | Una zona como texto (filas + legend) |
| `new_canvas`, `resize_canvas` | Crear o redimensionar el lienzo |
| `draw_grid` | Dibujar sprites con filas de caracteres y un legend de colores |
| `draw_pixels`, `draw_line`, `draw_rect`, `draw_ellipse`, `fill` | Píxeles sueltos, figuras y relleno |
| `draw_text` | Texto con fuentes pixel (5×7 con acentos y ñ, mini 3×5), contorno y sombra; `measure` mide sin dibujar |
| `replace_color`, `clear`, `transform_layer`, `move_region` | Editar lo que ya está dibujado |
| `animate_sprite` | Genera una animación completa en un paso desde el sprite de una capa: `idle`, `walk`, `run`, `jump`, `bounce`, `float`, `shake`, `spin`, `pulse`, `attack`, `hurt` |
| `create_animation` | Claude dibuja cada pose (filas + legend) y se crean todos los frames en una llamada |
| `view_animation` | Imagen con todos los frames lado a lado, para revisar la animación |
| `layer`, `frame` | Gestionar capas y frames de animación |
| `set_palette` | Cambiar la paleta |
| `batch` | Muchas operaciones en una llamada atómica (un solo paso de deshacer) |
| `undo`, `redo` | Deshacer y rehacer |
| `export_file`, `open_file` | Guardar `.png`, `.gif` u `.opx`, y abrir `.opx` |
| `show_status`, `open_editor` | Mostrar un mensaje en el editor y abrir el navegador |

## Funciones del editor

- **Herramientas:** lápiz, borrador, bote (contiguo o global), cuentagotas, línea, rectángulo y elipse (contorno o relleno; Mayús para proporciones perfectas), tramado (dither), sombreado (aclarar u oscurecer), texto, mover capa y mano.
- **Selección:** rectangular, lazo (libre) y varita mágica (por color, contigua o global). Mayús suma y Ctrl resta a la selección. Se puede mover (Alt copia), copiar, cortar, pegar y borrar. Mientras hay una selección, todo lo que se dibuja queda dentro de ella.
- **Texto:** dos fuentes pixel (5×7 con minúsculas, acentos, ñ, ¿ ¡ y símbolos; mini 3×5), escala, contorno y sombra, con vista previa en vivo.
- **Opciones de pincel:** tamaño 1–32, pincel cuadrado o redondo, espejo horizontal, vertical o en ambos ejes.
- **Capas:** visibilidad, bloqueo, opacidad, renombrar, reordenar, duplicar, combinar hacia abajo.
- **Animación:** frames, duración por frame (fps), papel cebolla y vista previa animada. El menú **✨ Animar capa…** genera en un clic caminar, correr, saltar, rebotar, flotar, temblar, girar, latir, atacar o recibir daño a partir del sprite de la capa activa.
- **Lienzo y vista:** zoom y paneo, cuadrícula, voltear y rotar, redimensionar con anclaje.
- **Color:** principal y secundario, paletas predefinidas, paleta editable.
- **Archivos:** abrir y guardar `.opx`, importar imágenes, exportar PNG escalado, GIF animado y spritesheet.
- **Historial:** deshacer y rehacer compartidos entre tú y Claude.

## Desarrollo

```bash
npm run dev        # servidor + Vite con HMR en http://localhost:5173
npm test           # pruebas del núcleo
npm run typecheck
```

Estructura:

- `packages/core`: modelo del documento, operaciones, historial, rasterizado y codificador GIF (TypeScript puro, compartido).
- `packages/server`: servidor HTTP/WebSocket, API RPC y servidor MCP.
- `apps/web`: editor en React + Canvas.

Todos los cambios, vengan del mouse o de Claude, son *operaciones* serializables que el servidor aplica y retransmite a los editores conectados.

El servidor solo escucha en `127.0.0.1`. Rechaza peticiones con un `Host` que no sea localhost y WebSockets de orígenes externos. La API RPC exige un encabezado propio, así que otras páginas web no pueden usarla.
