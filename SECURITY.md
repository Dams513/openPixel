# Seguridad

## Reportar una vulnerabilidad

Si encuentras un fallo de seguridad, **no abras un issue público**. Usa
**Security → Report a vulnerability** en este repositorio (reporte privado de GitHub).
Responderemos lo antes posible.

## Cómo protege openPixel tu computadora

openPixel es una app **local**: el servidor solo escucha en `127.0.0.1` (no es accesible desde otras
computadoras de tu red ni desde internet).

| Riesgo | Protección |
|---|---|
| Otra página web intenta controlar openPixel desde tu navegador (CSRF) | La API exige un encabezado propio (`x-openpixel`) y JSON; los navegadores no pueden enviarlo a otro sitio sin permiso. Además se rechazan orígenes que no sean el propio editor. |
| *DNS rebinding* (un dominio externo que apunta a `127.0.0.1`) | Solo se aceptan peticiones dirigidas a `localhost` / `127.0.0.1`. |
| WebSocket desde otra web o desde otra app local | Solo se aceptan conexiones del propio editor (mismo puerto o el servidor de desarrollo). Máximo 32 pestañas. |
| Incrustar el editor en otra web (*clickjacking*) | `X-Frame-Options: DENY` y `frame-ancestors 'none'`. |
| Scripts inyectados | Content-Security-Policy estricta (`script-src 'self'`), `nosniff`, sin `referrer`. |
| Leer archivos fuera de la carpeta del editor | Protección contra *path traversal* al servir el editor. |
| Que la IA sea manipulada (*prompt injection*) para leer o escribir archivos sensibles | `export_file` / `open_file` solo aceptan `.png`, `.gif`, `.opx`, `.json`, solo dentro de tu carpeta de usuario o la carpeta temporal, y nunca en carpetas ocultas (`.ssh`, `.config`…) ni `AppData`. Se resuelven los enlaces simbólicos para que no puedan escapar. |
| Archivos `.opx` manipulados para agotar la memoria | Límites: 1024×1024 px, 64 capas, 256 frames y un presupuesto total de píxeles; textos y paletas limitados. |

### Configuración

- `OPENPIXEL_ALLOWED_DIRS`: carpetas donde se permite abrir/guardar (separadas por `:` en macOS/Linux o `;` en Windows). Por defecto: tu carpeta de usuario y la temporal.
- `OPENPIXEL_PORT`: puerto del servidor (5577 por defecto).

## En el repositorio

- **CI** ejecuta pruebas (incluidas pruebas de seguridad), revisión de tipos y `npm audit` en cada cambio.
- **CodeQL** analiza el código en busca de vulnerabilidades en cada cambio y cada semana.
- **Dependabot** propone actualizaciones de dependencias.
