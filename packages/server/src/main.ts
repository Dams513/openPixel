/** Standalone editor server: `npm start` → http://localhost:5577 */
import { Host, log } from './host';
import { editorUrl, getPort, startServer } from './http';
import { openBrowser } from './backend';

const host = new Host();
try {
  const s = await startServer(host, getPort());
  console.log(`\n  openPixel listo →  ${editorUrl(s.port)}\n`);
  if (process.argv.includes('--open')) openBrowser(editorUrl(s.port));
  const stop = async () => {
    await s.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    log(`El puerto ${getPort()} ya está en uso (¿openPixel ya está abierto?). Abre ${editorUrl()} o usa OPENPIXEL_PORT.`);
  } else {
    log((e as Error).message);
  }
  process.exit(1);
}
