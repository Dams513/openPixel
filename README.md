# openPixel

Editor de pixel art **local** en el navegador, con un servidor **MCP** para que Claude dibuje contigo en tiempo real: tú ves cada trazo al instante y puedes deshacerlo con Ctrl+Z.

```
Claude ──MCP (stdio)──▶ servidor openPixel (Node) ──WebSocket──▶ editor en el navegador
```

## Instalación paso a paso

Se instala una sola vez. Toma unos 5 minutos.

### Paso 1. Instalar Node.js

1. Entra a <https://nodejs.org> y descarga la versión **LTS** (20 o superior).
2. Instálala con las opciones por defecto (en Windows deja marcada la opción *Add to PATH*).
3. Abre una terminal nueva:
   - **Windows:** menú Inicio → escribe `PowerShell` → Enter.
   - **macOS:** Aplicaciones → Utilidades → Terminal.
4. Comprueba que quedó instalado:

   ```bash
   node -v
   ```

   Debe mostrar algo como `v22.x.x`. Si dice "no se reconoce", cierra la terminal, ábrela de nuevo o reinicia la computadora.

### Paso 2. Descargar openPixel

**Opción A: con Git (recomendada, se actualiza más fácil).** Si no tienes Git, instálalo desde <https://git-scm.com>.

```bash
git clone https://github.com/Dams513/openPixel.git
```

**Opción B: ZIP.** En GitHub pulsa **Code → Download ZIP** y descomprímelo. Evita dejarlo dentro de *Descargas* si luego vas a borrar esa carpeta; por ejemplo, muévelo a tu carpeta de usuario (`C:\Users\TU_USUARIO\openPixel`).

### Paso 3. Instalar dependencias y compilar

En la terminal entra a la carpeta del proyecto (la que contiene `package.json`) y ejecuta:

```bash
cd openPixel
```

```bash
npm install
```

```bash
npm run build
```

Al terminar debe existir el archivo `packages/server/dist/mcp.js`.

### Paso 4. Probar el editor

```bash
npm start
```

Abre <http://localhost:5577> en tu navegador. El dibujo se guarda solo en `~/.openpixel/autosave.opx` (en Windows, `C:\Users\TU_USUARIO\.openpixel\`). Para cerrar el servidor pulsa `Ctrl + C` en la terminal.

### Paso 5. Obtener la ruta del servidor MCP

Claude necesita la **ruta completa** de `mcp.js`. Ejecuta esto dentro de la carpeta del proyecto:

- **Windows (PowerShell):**

  ```bash
  (Resolve-Path packages\server\dist\mcp.js).Path
  ```

- **macOS / Linux:**

  ```bash
  realpath packages/server/dist/mcp.js
  ```

También puedes verla en el editor: botón **?** → *Conectar Claude*.

### Paso 6. Conectar Claude

#### Claude Desktop

1. Abre Claude Desktop → **Ajustes** (Settings) → **Desarrollador** (Developer) → **Editar configuración** (Edit Config). Se abre el archivo `claude_desktop_config.json`:
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Pega esto, cambiando la ruta por la del paso 5:

   **Windows** (cada `\` se escribe doble `\\`):

   ```json
   {
     "mcpServers": {
       "openpixel": {
         "command": "node",
         "args": ["C:\\Users\\TU_USUARIO\\openPixel\\packages\\server\\dist\\mcp.js"]
       }
     }
   }
   ```

   **macOS:**

   ```json
   {
     "mcpServers": {
       "openpixel": {
         "command": "node",
         "args": ["/Users/TU_USUARIO/openPixel/packages/server/dist/mcp.js"]
       }
     }
   }
   ```

   Si ya tenías otros servidores en `mcpServers`, agrega `"openpixel": {...}` junto a ellos, separado por una coma.
3. Guarda el archivo y **cierra Claude Desktop por completo**: en Windows, clic derecho en su ícono junto al reloj → *Salir*; en macOS, `Cmd + Q`. Luego vuelve a abrirlo.
4. En un chat nuevo, el ícono de herramientas debe mostrar las de **openpixel**.

#### Claude Code

```bash
claude mcp add openpixel -s user -- node "/RUTA/COMPLETA/openPixel/packages/server/dist/mcp.js"
```

### Paso 7. ¡A dibujar!

Pídele a Claude, por ejemplo: *"Dibuja un gato pixel art de 32×32 en openPixel"*. Si el editor no está abierto, Claude lo levanta solo y abre tu navegador; si ya lo abriste con `npm start`, se conecta a ese. Verás cada trazo en vivo.

### Actualizar a una versión nueva

- **Con Git:**

  ```bash
  git pull
  ```

  ```bash
  npm install
  ```

  ```bash
  npm run build
  ```

- **Con ZIP:** descarga el ZIP otra vez, reemplaza la carpeta (en la misma ruta) y repite el paso 3.

Después reinicia Claude Desktop.

### Solución de problemas

| Problema | Solución |
|---|---|
| `node` o `npm` "no se reconoce" | Reinstala Node.js (paso 1) y abre una terminal **nueva**. |
| No aparecen las herramientas de openpixel en Claude | Revisa que la ruta del JSON exista y use `\\` en Windows; cierra Claude Desktop desde el ícono del reloj (no solo la ventana). En **Ajustes → Desarrollador** verás el estado del servidor y sus errores. |
| El navegador dice "El editor web no está compilado" | Ejecuta `npm run build` en la carpeta del proyecto. |
| "El puerto 5577 está ocupado" | Usa otro puerto: en el JSON de Claude agrega `"env": { "OPENPIXEL_PORT": "5600" }` junto a `"args"` y abre `http://localhost:5600`. |
| "Por seguridad solo se pueden usar archivos dentro de…" | Guarda/abre archivos dentro de tu carpeta de usuario (Escritorio, Documentos, Descargas…), o configura `OPENPIXEL_ALLOWED_DIRS` (ver [SECURITY.md](SECURITY.md)). |

Variables opcionales: `OPENPIXEL_PORT` (puerto, 5577 por defecto), `OPENPIXEL_HOME` (carpeta de autoguardado), `OPENPIXEL_NO_BROWSER=1` (no abrir el navegador), `OPENPIXEL_ALLOWED_DIRS` (carpetas donde se puede guardar y abrir).

## Herramientas MCP

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
npm test           # pruebas (núcleo, funciones y seguridad)
npm run typecheck
```

Estructura:

- `packages/core`: modelo del documento, operaciones, historial, rasterizado y codificador GIF (TypeScript puro, compartido).
- `packages/server`: servidor HTTP/WebSocket, API RPC y servidor MCP.
- `apps/web`: editor en React + Canvas.

Todos los cambios, vengan del mouse o de Claude, son *operaciones* serializables que el servidor aplica y retransmite a los editores conectados.

## Seguridad

openPixel funciona solo en tu computadora: el servidor escucha únicamente en `127.0.0.1`, bloquea a otras páginas web y limita qué archivos puede leer o escribir la IA. Los detalles y cómo reportar un problema están en [SECURITY.md](SECURITY.md).
